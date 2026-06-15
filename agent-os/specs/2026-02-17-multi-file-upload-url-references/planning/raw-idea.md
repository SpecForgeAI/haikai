# Multi-File Upload + URL References for SA and PM Chat

## Raw Idea

Replace the current text-path-based UploadDocumentsModal with a proper file upload mechanism:
- Native file picker (multiple files) with chips showing selected files
- User types a message that may reference public URLs
- Single Send action sends everything to the gateway
- Gateway fetches URL content server-side, receives file bytes from frontend
- Gateway builds a single OpenAI message with content parts array (text + file + image_url)
- Single OpenAI API call to GPT-5 with all content

## Scope Includes

- Frontend: Replace UploadDocumentsModal with native file picker + chips in input area
- Frontend: Read selected files as base64 on Send
- Frontend: New ChatRequest shape with files array (filename, mimeType, base64)
- Frontend: Remove sources field from ChatRequest
- Gateway: Accept files array from JSON body, increase body size limit
- Gateway: Extract URLs from message text, fetch content server-side
- Gateway: Build OpenAI content parts array (text, file, image_url) based on MIME type
- Gateway: Update OpenAIMessage interface to support content parts array
- Gateway: Strip file content from conversation persistence (store filenames only)
- Gateway: Update buildAugmentedMessage to handle URLs only (files handled separately)
- Both SA and PM chat panels (identical mechanism)
- Target GPT-5 model compatibility

## Scope Excludes

- Drag-and-drop file upload (future enhancement)
- File preview/thumbnails in chat
- Server-side file storage/caching
- Changes to other chat modes (OAS assistant, implement_feature, roadmap_pm)
- Conversation rehydration of file content (only filenames stored)

## Systems Involved

- frontend: SolutionArchitectChatPanel, ProductManagerChatPanel, chatApi
- gateway: chat.ts route handler, openaiClient.ts, conversation.ts
- unchanged: mcp-server, architecture-model-service
