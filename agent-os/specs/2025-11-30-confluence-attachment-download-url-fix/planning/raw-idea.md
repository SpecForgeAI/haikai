# Feature: Confluence Attachment Download URL Fix - Separate API vs UI Base URLs

## Context

The backend currently assumes the same base URL used for Confluence REST API (api.atlassian.com) can be used for file download URLs. This is incorrect.

Confluence Cloud returns attachment download URLs as UI-relative URLs (e.g. `/download/attachments/...`) that must be resolved against the site's UI base URL (e.g. `https://<site>.atlassian.net/wiki`). Attachment files do NOT come from the api.atlassian.com base URL.

## Requirements

1) Separate configuration for API base URL vs UI/File base URL in application.yml
2) Two distinct WebClients/RestClients: one for JSON API calls, one for file downloads
3) Updated attachment download logic to use the correct client and base URL

## Configuration Changes Needed

- `api-base-url` – for REST API calls (pages, attachments metadata, etc.)
- `ui-and-file-base-url` – for UI-relative file download URLs

### Example Config

```yaml
confluence:
  api-base-url: https://api.atlassian.com/ex/confluence/867ce29e-9357-480a-9da6-830c0e2fd5c0/wiki
  ui-and-file-base-url: https://garyjohnston83.atlassian.net/wiki
  username: gjjfintech-8mw1g8co7n@serviceaccount.atlassian.com
  api-token: <existing token>
```

## Two WebClients Needed

- **API client (JSON metadata)** - Base URL: confluence.api-base-url, Headers: Authorization + Accept: application/json
- **File client (UI/file downloads)** - Base URL: confluence.ui-and-file-base-url, Headers: Authorization only

## Fix downloadAttachment Logic

- Use fileClient for all attachment downloads
- Handle both absolute and relative download URLs
- Relative URLs resolved against ui-and-file-base-url

## URL Encoding Considerations

- Confluence download URLs may contain spaces or special characters
- WebClient should handle encoding properly

## Acceptance Criteria

- Relative download URLs correctly resolved to https://<site>.atlassian.net/wiki/download/attachments/...
- Attachments successfully downloaded as byte[] using fileClient
- API calls continue working using apiClient and api-base-url
- No regressions in existing Confluence integration
