package router

import (
	"khairul169/garage-webui/schema"
	"khairul169/garage-webui/utils"
	"net/http"
)

type Config struct{}

type ConfigResponse struct {
	schema.Config
	S3Endpoint string `json:"s3_endpoint"`
}

func (c *Config) GetAll(w http.ResponseWriter, r *http.Request) {
	resp := ConfigResponse{
		Config:     utils.Garage.Config,
		S3Endpoint: utils.Garage.GetPublicS3Endpoint(),
	}
	utils.ResponseSuccess(w, resp)
}
