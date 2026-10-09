package router

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"khairul169/garage-webui/schema"
	"khairul169/garage-webui/utils"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type PresignRequest struct {
	Key         string   `json:"key"`
	Keys        []string `json:"keys"`
	AccessKeyID string   `json:"accessKeyId"`
	ExpiresIn   int      `json:"expiresIn"` // in seconds
	Endpoint    string   `json:"endpoint"`   // optional custom endpoint override
}

type PresignResponse struct {
	URLs      []string `json:"urls"`
	ExpiresIn int      `json:"expiresIn"`
}

// PresignObjects generates S3 path-style presigned GET URLs for one or more keys.
func (b *Browse) PresignObjects(w http.ResponseWriter, r *http.Request) {
	bucket := r.PathValue("bucket")
	if bucket == "" {
		utils.ResponseErrorStatus(w, errors.New("bucket is required"), http.StatusBadRequest)
		return
	}

	var req PresignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ResponseErrorStatus(w, fmt.Errorf("invalid request body: %w", err), http.StatusBadRequest)
		return
	}

	keys := req.Keys
	if len(keys) == 0 && req.Key != "" {
		keys = []string{req.Key}
	}
	if len(keys) == 0 {
		utils.ResponseErrorStatus(w, errors.New("at least one key is required"), http.StatusBadRequest)
		return
	}

	expiresIn := time.Duration(req.ExpiresIn) * time.Second
	if expiresIn <= 0 {
		expiresIn = time.Hour
	}
	// AWS S3 maximum expiration is 7 days
	if expiresIn > 7*24*time.Hour {
		expiresIn = 7 * 24 * time.Hour
	}

	// Fetch bucket info to validate access key and permissions
	bucketData, err := fetchBucketInfo(bucket)
	if err != nil {
		utils.ResponseError(w, fmt.Errorf("cannot get bucket info for %s: %w", bucket, err))
		return
	}

	accessKeyID := req.AccessKeyID
	if accessKeyID == "" {
		// Pick the first key with read permission
		for _, k := range bucketData.Keys {
			if k.Permissions.Read {
				accessKeyID = k.AccessKeyID
				break
			}
		}
		if accessKeyID == "" {
			utils.ResponseErrorStatus(w, errors.New("no key with read access found for bucket"), http.StatusBadRequest)
			return
		}
	} else {
		// Validate that the specified key belongs to bucket and has read permission
		found := false
		for _, k := range bucketData.Keys {
			if k.AccessKeyID == accessKeyID {
				if !k.Permissions.Read {
					utils.ResponseErrorStatus(w, fmt.Errorf("key %s does not have read access to bucket", accessKeyID), http.StatusForbidden)
					return
				}
				found = true
				break
			}
		}
		if !found {
			utils.ResponseErrorStatus(w, fmt.Errorf("key %s is not granted to bucket %s", accessKeyID, bucket), http.StatusForbidden)
			return
		}
	}

	// Fetch secret access key
	secretKey, err := getKeySecret(accessKeyID)
	if err != nil {
		utils.ResponseError(w, fmt.Errorf("cannot get credentials for key %s: %w", accessKeyID, err))
		return
	}

	endpoint := strings.TrimSpace(req.Endpoint)
	if endpoint == "" {
		endpoint = utils.Garage.GetPublicS3Endpoint()
	}

	region := utils.Garage.GetS3Region()

	urls, err := presignObjectUrls(r.Context(), endpoint, region, bucket, accessKeyID, secretKey, keys, expiresIn)
	if err != nil {
		utils.ResponseError(w, err)
		return
	}

	utils.ResponseSuccess(w, PresignResponse{
		URLs:      urls,
		ExpiresIn: int(expiresIn.Seconds()),
	})
}

func fetchBucketInfo(bucket string) (*schema.Bucket, error) {
	cacheKey := "bucketinfo:" + bucket
	if cached := utils.Cache.Get(cacheKey); cached != nil {
		return cached.(*schema.Bucket), nil
	}

	body, err := utils.Garage.Fetch("/v2/GetBucketInfo?globalAlias="+url.QueryEscape(bucket), &utils.FetchOptions{})
	if err != nil {
		body, err = utils.Garage.Fetch("/v2/GetBucketInfo?id="+url.QueryEscape(bucket), &utils.FetchOptions{})
		if err != nil {
			return nil, err
		}
	}

	var bucketData schema.Bucket
	if err := json.Unmarshal(body, &bucketData); err != nil {
		return nil, err
	}

	utils.Cache.Set(cacheKey, &bucketData, 2*time.Minute)
	return &bucketData, nil
}

func getKeySecret(accessKeyID string) (string, error) {
	cacheKey := "keysecret:" + accessKeyID
	if cached := utils.Cache.Get(cacheKey); cached != nil {
		return cached.(string), nil
	}

	body, err := utils.Garage.Fetch(fmt.Sprintf("/v2/GetKeyInfo?id=%s&showSecretKey=true", url.QueryEscape(accessKeyID)), &utils.FetchOptions{})
	if err != nil {
		return "", err
	}

	var key schema.KeyElement
	if err := json.Unmarshal(body, &key); err != nil {
		return "", err
	}

	if key.SecretAccessKey == "" {
		return "", errors.New("secret access key not found")
	}

	utils.Cache.Set(cacheKey, key.SecretAccessKey, time.Hour)
	return key.SecretAccessKey, nil
}

func presignObjectUrls(ctx context.Context, endpoint, region, bucket, accessKeyID, secretKey string, keys []string, duration time.Duration) ([]string, error) {
	creds := credentials.NewStaticCredentialsProvider(accessKeyID, secretKey, "")
	client := newS3Client(endpoint, region, creds)
	presignClient := s3.NewPresignClient(client)

	urls := make([]string, 0, len(keys))
	for _, key := range keys {
		req, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(key),
		}, func(opts *s3.PresignOptions) {
			opts.Expires = duration
		})
		if err != nil {
			return nil, fmt.Errorf("failed to presign key %s: %w", key, err)
		}
		urls = append(urls, req.URL)
	}

	return urls, nil
}
