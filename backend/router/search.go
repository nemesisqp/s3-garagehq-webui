package router

import (
	"context"
	"khairul169/garage-webui/schema"
	"khairul169/garage-webui/utils"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

var (
	// searchScanLimit caps how many folder entries one search reads.
	searchScanLimit = 50000
	searchCacheTTL  = 30 * time.Second
)

// searchTokenPrefix marks a search page token (an offset into the matches),
// so it can't be confused with an S3 continuation token.
const searchTokenPrefix = "s:"

type searchMatches struct {
	Prefixes  []string
	Objects   []types.Object
	Truncated bool
}

// minSearchLength is the minimum search query length to prevent expensive full scans.
const minSearchLength = 2

// searchFolder lists entries under prefix recursively and keeps the ones
// whose filename or folder name contains term (ignoring case), or if term
// contains a slash, matches the relative path.
func searchFolder(ctx context.Context, client s3API, bucket, prefix, term string) (*searchMatches, error) {
	trimmed := strings.TrimSpace(term)
	if len(trimmed) < minSearchLength {
		return &searchMatches{}, nil
	}

	needle := strings.ToLower(trimmed)
	hasSlash := strings.Contains(needle, "/")
	matches := &searchMatches{}
	seenPrefixes := make(map[string]bool)
	scanned := 0
	var token *string

	for {
		list, err := client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(bucket),
			Prefix:            aws.String(prefix),
			ContinuationToken: token,
		})
		if err != nil {
			return nil, err
		}

		for _, o := range list.Contents {
			key := aws.ToString(o.Key)
			relKey := strings.TrimPrefix(key, prefix)
			if relKey == "" {
				continue
			}

			// If this object represents an explicit directory marker (ends with /)
			if strings.HasSuffix(key, "/") {
				dirRel := strings.TrimSuffix(relKey, "/")
				dirName := dirRel
				if i := strings.LastIndex(dirName, "/"); i >= 0 {
					dirName = dirName[i+1:]
				}
				if strings.Contains(strings.ToLower(dirName), needle) ||
					(hasSlash && strings.Contains(strings.ToLower(dirRel), needle)) {
					if !seenPrefixes[key] {
						seenPrefixes[key] = true
						matches.Prefixes = append(matches.Prefixes, key)
					}
				}
				continue
			}

			parts := strings.Split(relKey, "/")
			// Virtual intermediate subdirectories
			if len(parts) > 1 {
				cur := prefix
				for i := 0; i < len(parts)-1; i++ {
					folderName := parts[i]
					cur += folderName + "/"
					if strings.Contains(strings.ToLower(folderName), needle) {
						if !seenPrefixes[cur] {
							seenPrefixes[cur] = true
							matches.Prefixes = append(matches.Prefixes, cur)
						}
					}
				}
			}

			// Match file name (or relative path if search contains slash)
			filename := parts[len(parts)-1]
			if strings.Contains(strings.ToLower(filename), needle) ||
				(hasSlash && strings.Contains(strings.ToLower(relKey), needle)) {
				matches.Objects = append(matches.Objects, o)
			}
		}
		scanned += len(list.Contents)

		if !aws.ToBool(list.IsTruncated) {
			return matches, nil
		}
		if scanned >= searchScanLimit {
			matches.Truncated = true
			return matches, nil
		}
		token = list.NextContinuationToken
	}
}

// searchObjects answers one page of a folder search. The full match list is
// cached briefly so paging through results doesn't re-list the folder; a new
// search (no page token) always re-lists.
func searchObjects(ctx context.Context, client s3API, bucket, prefix, term, next string, limit int) (schema.BrowseObjectResult, error) {
	trimmed := strings.TrimSpace(term)
	if len(trimmed) < minSearchLength {
		return schema.BrowseObjectResult{
			Prefixes: []string{},
			Objects:  []schema.BrowserObject{},
			Prefix:   prefix,
		}, nil
	}

	cacheKey := "search:" + bucket + "\x00" + prefix + "\x00" + strings.ToLower(trimmed)
	offset := parseSearchToken(next)

	matches, _ := utils.Cache.Get(cacheKey).(*searchMatches)
	if matches == nil || offset == 0 {
		found, err := searchFolder(ctx, client, bucket, prefix, trimmed)
		if err != nil {
			return schema.BrowseObjectResult{}, err
		}
		matches = found
		utils.Cache.Set(cacheKey, matches, searchCacheTTL)
	}

	return searchPage(bucket, prefix, matches, offset, limit), nil
}

func parseSearchToken(next string) int {
	if !strings.HasPrefix(next, searchTokenPrefix) {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimPrefix(next, searchTokenPrefix))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// searchPage slices one page out of the matches: folders first, then files,
// the same order as a normal listing.
func searchPage(bucket, prefix string, matches *searchMatches, offset, limit int) schema.BrowseObjectResult {
	if limit <= 0 {
		limit = 100
	}
	nPrefixes := len(matches.Prefixes)
	total := nPrefixes + len(matches.Objects)
	offset = min(offset, total)
	end := min(offset+limit, total)

	res := schema.BrowseObjectResult{
		Prefixes:  []string{},
		Objects:   []schema.BrowserObject{},
		Prefix:    prefix,
		Truncated: matches.Truncated,
	}
	if offset < nPrefixes {
		res.Prefixes = append(res.Prefixes, matches.Prefixes[offset:min(end, nPrefixes)]...)
	}
	if end > nPrefixes {
		res.Objects = toBrowserObjects(bucket, prefix, matches.Objects[max(offset-nPrefixes, 0):end-nPrefixes])
	}
	if end < total {
		res.NextToken = aws.String(searchTokenPrefix + strconv.Itoa(end))
	}
	return res
}
