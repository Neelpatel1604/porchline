output "instance_id" {
  description = "EC2 instance id for the Porchline voice host."
  value       = aws_instance.voice.id
}

output "public_ip" {
  description = "Stable public IP (Elastic IP when enabled)."
  value       = var.associate_elastic_ip ? aws_eip.voice[0].public_ip : aws_instance.voice.public_ip
}

output "public_dns" {
  description = "Public DNS name on the instance (may change without EIP)."
  value       = aws_instance.voice.public_dns
}

output "security_group_id" {
  description = "Security group attached to the voice instance."
  value       = aws_security_group.voice.id
}

output "ssh_example" {
  description = "Example SSH command (replace the key path)."
  value       = "ssh -i /path/to/${var.key_name}.pem ubuntu@${var.associate_elastic_ip ? aws_eip.voice[0].public_ip : aws_instance.voice.public_ip}"
}

output "twilio_hints" {
  description = "Values to set after you put Caddy/nginx TLS in front of uvicorn on :8000."
  value = {
    voice_webhook     = "https://YOUR_DOMAIN/twilio/voice"
    public_voice_wss  = "wss://YOUR_DOMAIN/twilio/stream"
    health_check      = "https://YOUR_DOMAIN/health"
    note              = "Point YOUR_DOMAIN A record at the public_ip output, then terminate TLS to 127.0.0.1:8000."
  }
}
