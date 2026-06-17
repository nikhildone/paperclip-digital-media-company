# Remote Connector

Paperclip should send media jobs to another service.

Needed settings:

- worker url
- worker token
- render mode remote

Flow:

1. Paperclip receives task.
2. Paperclip checks brand rules.
3. Paperclip sends job.
4. Worker returns status and links.
5. Paperclip stores links.
6. QA checks the result.
