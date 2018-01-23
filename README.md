node-youtube-resumable-upload
=============================

Upload large videos to youtube (and others) via Google's 'resumable upload' API, following https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

Benchmarked with an 800mb video - this module bypasses the filesize restrictions on node's `fs.readFileSync()` (used by the official googleapis node client for uploading) by using `fs.createReadStream()` and then piping the stream to Youtube's servers.


How to Use
==========

View `example.js`