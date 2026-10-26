terraform {
  # Local CLI may be 1.16.x; HCP / install can use 1.17.x.
  required_version = ">= 1.16.6, < 2.0.0"

  # State lives in HCP Terraform. Set TF_CLOUD_ORGANIZATION in your shell
  # (do not commit the org name). Workspace name is the product name only.
  cloud {
    workspaces {
      name = "porchline"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
  }
}
