package router

import (
	"context"
	"khairul169/garage-webui/utils"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestPresignObjectUrls(t *testing.T) {
	endpoint := "http://localhost:3900"
	region := "garage"
	bucket := "test-bucket"
	accessKeyID := "GK1234567890ABCDEF"
	secretKey := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	keys := []string{"photo.jpg", "docs/nested report.pdf"}
	duration := 2 * time.Hour

	urls, err := presignObjectUrls(context.Background(), endpoint, region, bucket, accessKeyID, secretKey, keys, duration)
	if err != nil {
		t.Fatalf("presignObjectUrls failed: %v", err)
	}

	if len(urls) != 2 {
		t.Fatalf("expected 2 urls, got %d", len(urls))
	}

	for i, rawURL := range urls {
		parsed, err := url.Parse(rawURL)
		if err != nil {
			t.Fatalf("url %d is invalid: %v", i, err)
		}

		if parsed.Scheme != "http" || parsed.Host != "localhost:3900" {
			t.Errorf("expected host http://localhost:3900, got %s://%s", parsed.Scheme, parsed.Host)
		}

		// Verify path-style: path starts with /<bucket>/
		expectedPrefix := "/" + bucket + "/"
		if !strings.HasPrefix(parsed.Path, expectedPrefix) {
			t.Errorf("url path %q does not start with %q (not path-style)", parsed.Path, expectedPrefix)
		}

		// Verify AWS SigV4 query params
		query := parsed.Query()
		if query.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" {
			t.Errorf("expected X-Amz-Algorithm=AWS4-HMAC-SHA256, got %q", query.Get("X-Amz-Algorithm"))
		}
		if !strings.HasPrefix(query.Get("X-Amz-Credential"), accessKeyID) {
			t.Errorf("expected X-Amz-Credential to start with accessKeyID, got %q", query.Get("X-Amz-Credential"))
		}
		if query.Get("X-Amz-Signature") == "" {
			t.Errorf("expected non-empty X-Amz-Signature")
		}
		if query.Get("X-Amz-Expires") != "7200" {
			t.Errorf("expected X-Amz-Expires=7200, got %q", query.Get("X-Amz-Expires"))
		}
	}
}

func TestGetPublicS3EndpointPriority(t *testing.T) {
	origConfig := utils.Garage.Config
	defer func() {
		utils.Garage.Config = origConfig
	}()

	// 1. advertise_endpoint has highest priority
	utils.Garage.Config.S3API.AdvertiseEndpoint = "https://s3.advertised.net"
	utils.Garage.Config.S3API.RootDomain = ".s3.rootdomain.net"
	if got := utils.Garage.GetPublicS3Endpoint(); got != "https://s3.advertised.net" {
		t.Errorf("expected https://s3.advertised.net, got %q", got)
	}

	// advertise_endpoint without scheme defaults to https://
	utils.Garage.Config.S3API.AdvertiseEndpoint = "s3.no-scheme.net"
	if got := utils.Garage.GetPublicS3Endpoint(); got != "https://s3.no-scheme.net" {
		t.Errorf("expected https://s3.no-scheme.net, got %q", got)
	}

	// 2. root_domain is second priority, defaults to https:// and strips leading dots
	utils.Garage.Config.S3API.AdvertiseEndpoint = ""
	utils.Garage.Config.S3API.RootDomain = ".s3.rootdomain.net"
	if got := utils.Garage.GetPublicS3Endpoint(); got != "https://s3.rootdomain.net" {
		t.Errorf("expected https://s3.rootdomain.net, got %q", got)
	}

	utils.Garage.Config.S3API.RootDomain = "s3.rootdomain.net"
	if got := utils.Garage.GetPublicS3Endpoint(); got != "https://s3.rootdomain.net" {
		t.Errorf("expected https://s3.rootdomain.net, got %q", got)
	}

	// 3. Fallback to default when neither is set
	utils.Garage.Config.S3API.AdvertiseEndpoint = ""
	utils.Garage.Config.S3API.RootDomain = ""
	utils.Garage.Config.RPCPublicAddr = "localhost:3901"
	utils.Garage.Config.S3API.APIBindAddr = "[::]:3900"
	if got := utils.Garage.GetPublicS3Endpoint(); got != "http://localhost:3900" {
		t.Errorf("expected http://localhost:3900, got %q", got)
	}
}

