// Viewer request on the site's default behavior.  Every page is prerendered
// to <path>/index.html, so /policies/refunds/ and /policies/refunds are both
// served from /policies/refunds/index.html.  A path whose last part has an
// extension, such as /facts.json or a script, passes through.  A path with no
// page gets a 403 from S3, which the distribution answers with the app's shell
// and status 404.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.charAt(uri.length - 1) === '/') {
    request.uri = uri + 'index.html';
  } else if (uri.substring(uri.lastIndexOf('/') + 1).indexOf('.') === -1) {
    request.uri = uri + '/index.html';
  }
  return request;
}
