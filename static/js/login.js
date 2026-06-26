function handleCredentialResponse(response) {
  fetch('/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: response.credential }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.redirect) {
        window.location.href = data.redirect;
      } else if (data.user) {
        window.location.href = '/workspace';
      } else {
        throw new Error(data.error || 'Login failed');
      }
    })
    .catch(function () {
      window.location.href = '/login';
    });
}

window.onload = function () {
  google.accounts.id.initialize({
    client_id: googleClientID,
    callback: handleCredentialResponse,
  });
  google.accounts.id.renderButton(document.getElementById('googleLoginBtn'), {
    theme: 'outline',
    size: 'large',
  });
};
