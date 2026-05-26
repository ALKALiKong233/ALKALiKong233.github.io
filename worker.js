export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    let path = url.pathname
    if (path.endsWith("/")) {
      path += "index.html"
    } else if (!path.includes(".")) {
      path += "/index.html"
    }

    const assetReq = new Request(new URL(path, url.origin), request)
    let response = await env.ASSETS.fetch(assetReq)

    if (response.status === 404) {
      response = await env.ASSETS.fetch(
        new Request(new URL("/404.html", url.origin), request),
      )
    }

    return response
  },
}
