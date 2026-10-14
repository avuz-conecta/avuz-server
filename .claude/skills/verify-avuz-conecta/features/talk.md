# Talk

Talk is the chat and video app, shown as "Conversas". It uses a separate high-performance backend for calls and a recording bot that uploads in chunks, so recordings above 100 MB survive the CDN body cap.

## Sub-features

- `talk-chat` create a conversation and post a message that persists.
- `talk-icon` the themed chat icon is served.
- `talk-chunked-upload-patch` the running app carries the chunked-upload patch marker.

## How to get to it (user POV)

- Top navigation, `Conversas`, then start a new conversation.

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh` passes. Non-admin test user available. Conversation names use the prefix `verify-`.

- **Create.** Open Conversas, create a private conversation `verify-<run>`. Expect it in the list.
- **Message.** Post `verify message` and reload. Expect the message still there. Screenshot before and after reload.
- **Patch marker.** Run `scripts/portainer-exec.sh -u www-data <container> grep -rl AVUZ-CHUNKED-UPLOAD-V1 apps/spreed/lib`. Expect at least one file path (the `RecordingController.php`). Save output to the report folder.
- **Cleanup.** Delete the conversation as its owner.

## Gotchas

- Never start a call against a live room or load-test a link without the user starting it. This map does not place calls.
- Real recording, transcription and large-file upload paths are not covered here; they need a real call and the recording bot.
- The marker check proves the patch is in the image, not that a recording uploads.
