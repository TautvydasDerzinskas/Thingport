# Behind a reverse proxy

Thingport works on its own address, `http://<host>:<WEB_PORT>`. To give it a domain name or HTTPS, put a reverse proxy
in front of it, such as Nginx Proxy Manager, Caddy, Traefik or nginx. Point the proxy at the port Thingport's web
container listens on (`WEB_PORT`, 80 by default). That container runs nginx already and passes `/api` on to the
backend, so the proxy needs one host and no path rules of its own. HTTPS is up to you: Thingport works over plain HTTP
too.

The proxy has to let through what Thingport sends. When it turns a request down, the Thingport web app and the
Thingport Grab extension say that a proxy answered instead of Thingport, with the HTTP status it gave, and point here.

## What the proxy has to allow

| What                                                      | Why                                                                                                             | In nginx                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Request bodies up to 512 MB                               | Uploading models and files. Thingport's own nginx takes up to 512 MB.                                           | `client_max_body_size 512m;`                                               |
| Answers that take up to 5 minutes                         | A slow local AI model writing a description or sorting a model into a category                                  | `proxy_read_timeout 300s;`                                                 |
| Uploads to `/api/ap/link/replies/` passed on as they come | [Connected instances](connected-instances.md): a partner behind its router answers through them, files included | `proxy_request_buffering off;` and `client_max_body_size 0;` for that path |

Thingport Grab also sends a model's page with each import, so its requests are often tens of kilobytes. That's well
within any proxy's size limit, yet Nginx Proxy Manager answered them with HTTP 500 for one user until its buffers were
raised ([below](#nginx-proxy-manager)).

## Nginx Proxy Manager

Its defaults cut answers off after 90 seconds, and on some setups it answers Thingport Grab's imports with HTTP 500.
To fix both:

1. Open the proxy host for Thingport, click **Edit** and open the **Advanced** tab.
2. Paste this into **Custom Nginx Configuration**:

   ```nginx
   proxy_buffers 8 128k;
   proxy_buffer_size 256k;
   proxy_read_timeout 300s;
   ```

3. Click **Save**.

Its body size limit is 2000 MB already.

## nginx

A server block that passes Thingport on with the settings above. Replace `192.168.1.20:8080` with your Thingport
instance's address and port, and add your certificate lines if you serve it over HTTPS:

```nginx
server {
    listen 80;
    server_name thingport.example.com;

    client_max_body_size 512m;

    location / {
        proxy_pass         http://192.168.1.20:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # Only needed for connected instances.
    location ^~ /api/ap/link/replies/ {
        proxy_pass         http://192.168.1.20:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        client_max_body_size 0;
    }
}
```

In other proxies, look for the same three settings: the largest request body, how long it waits for an answer, and
whether it holds an upload back until it's whole.

## What the errors mean

| The message says                         | What happened                                                      | Fix                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| A proxy answered with HTTP 500, 400, 403 | The proxy turned the request down before Thingport got it          | Its error log says why. In Nginx Proxy Manager, add the [lines above](#nginx-proxy-manager).          |
| Too large (HTTP 413)                     | The request was bigger than the proxy's body size limit            | Raise it to 512 MB (`client_max_body_size 512m;`).                                                    |
| Isn't answering (HTTP 502 or 503)        | Thingport is starting up or stopped, or the proxy points elsewhere | Check that Thingport's containers are running (`docker compose ps`) and the proxy's address and port. |
| Took too long (HTTP 504)                 | The proxy stopped waiting before Thingport answered                | Raise its timeout to 5 minutes (`proxy_read_timeout 300s;`).                                          |
