# Mount as /app/config/initializers/atlas_communication_log_filter.rb in the pinned
# Chatwoot web and Sidekiq images. Verify third-party/app log producers separately.
Rails.application.config.filter_parameters += [
  :content, :processed_message_content, :body, :html, :attachments, :payload,
  :email, :phone_number, :from, :to, :password, :token, :api_access_token,
  :access_token, :refresh_token, :secret, :authorization
]

# Sidekiq's default exception handler may serialize job arguments (webhook bodies).
# Replace it with a metadata-only handler; monitoring uses the event and job ID.
Sidekiq.configure_server do |config|
  config.error_handlers.clear
  config.error_handlers << lambda do |exception, context, _configuration = nil|
    job = context[:job] || context['job'] || {}
    config.logger.error({
      event: 'chatwoot_job_failed',
      error_class: exception.class.name,
      job_class: job['class'].to_s.gsub(/[^A-Za-z0-9_:]/, '')[0, 80],
      job_id: job['jid'].to_s.gsub(/[^A-Za-z0-9_-]/, '')[0, 80]
    }.to_json)
  end
end
