var ResumableUpload = require('node-youtube-resumable-upload');
var credentials = {
  client_id: "",
  client_secret: "",
  access_token: "",
  token_type: 'Bearer',
  expiry_date: "",
  refresh_token: ""
};
var metadata = {
  "snippet":{
    "categoryId":17, //Sports
    "tags": ["node-youtube-resumable-upload"],
    "title": "title"
  },
  "status":{
    "privacyStatus": "private"
  }
};
let resumableUpload = new ResumableUpload();
resumableUpload.tokens = credentials;
resumableUpload.file = "https://example.com/example.mp4"
resumableUpload.metadata = metadata;
resumableUpload.retry = 3;
resumableUpload.playlists = [];
resumableUpload.upload();