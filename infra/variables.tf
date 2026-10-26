variable "aws_region" {
  description = "AWS region for the Porchline voice EC2 instance."
  type        = string
  default     = "us-east-1"
}

variable "instance_name" {
  description = "Name tag for the EC2 instance."
  type        = string
  default     = "porchline-voice"
}

variable "instance_type" {
  description = "EC2 instance type. t3.small is a reasonable floor for Pipecat + Higgs."
  type        = string
  default     = "t3.small"
}

variable "key_name" {
  description = "Existing EC2 key pair name in this region (create in AWS console first)."
  type        = string
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH (port 22). Prefer your public IP/32, not 0.0.0.0/0."
  type        = string
}

variable "root_volume_gb" {
  description = "Root EBS volume size in GiB."
  type        = number
  default     = 30
}

variable "associate_elastic_ip" {
  description = "Allocate and attach an Elastic IP so the public address stays stable for Twilio."
  type        = bool
  default     = true
}
