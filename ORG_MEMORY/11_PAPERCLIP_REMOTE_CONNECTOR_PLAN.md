# Paperclip Remote Connector Plan

## Goal
Paperclip should call the remote media worker when remote mode is enabled.

## Environment
- MEDIA_WORKER_URL
- MEDIA_WORKER_TOKEN
- PAPERCLIP_MEDIA_RENDER_MODE=remote

## Flow
1. User gives command in Paperclip.
2. Paperclip validates brand rules.
3. Paperclip prepares a media pack.
4. Paperclip sends the job to the remote worker.
5. Remote worker returns job status and file links.
6. Paperclip stores links and waits for human approval.

## Fallback
If remote mode is off, Paperclip may create only a safe text pack or use local low-resource mode for testing.
