const express = require('express')
const http = require('http')
const https = require('https')
const { URL } = require('url')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3010

// CORS для всех ответов
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD')
  res.header('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

function rewriteM3U8(body, baseUrl) {
  const lines = body.split(/\r?\n/)
  const out = []
  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith('#')) {
      out.push(line)
      continue
    }
    let absolute = line
    if (!/^https?:\/\//i.test(line)) {
      absolute = resolveUrl(baseUrl, line)
    }
    out.push('/proxy?url=' + encodeURIComponent(absolute))
  }
  return out.join('\n')
}

function isM3U8Response(proxyRes, url) {
  const ct = (proxyRes.headers['content-type'] || '').toLowerCase()
  const pathName = url.pathname || ''
  return ct.includes('mpegurl') ||
         ct.includes('m3u8') ||
         ct.includes('application/vnd.apple.mpegurl') ||
         pathName.endsWith('.m3u8') ||
         pathName.endsWith('.m3u')
}

// Рекурсивно следуем за редиректами (max 5)
function followProxy(targetUrl, reqHeaders, maxRedirects, callback) {
  let url
  try {
    url = new URL(targetUrl)
  } catch (e) {
    return callback(e)
  }

  const client = url.protocol === 'https:' ? https : http
  const isM3U8Request =
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.m3u') ||
    (reqHeaders.accept || '').toLowerCase().includes('mpegurl')

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers: { ...reqHeaders, host: url.host },
  }

  delete options.headers['origin']
  delete options.headers['connection']
  delete options.headers['upgrade-insecure-requests']
  // Подменяем referer на origin потока — многие IPTV-серверы требуют правильный referer
  options.headers['referer'] = url.origin + '/'

  if (isM3U8Request) {
    delete options.headers['accept-encoding']
  }

  const proxyReq = client.request(options, (proxyRes) => {
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location && maxRedirects > 0) {
      const redirectUrl = resolveUrl(targetUrl, proxyRes.headers.location)
      console.log('Redirect:', targetUrl, '->', redirectUrl)
      return followProxy(redirectUrl, reqHeaders, maxRedirects - 1, callback)
    }
    callback(null, proxyRes, targetUrl)
  })

  proxyReq.on('error', (err) => callback(err))
  proxyReq.end()
}

// Прокси для внешних URL
app.use('/proxy', (req, res) => {
  const targetUrl = req.query.url
  if (!targetUrl) return res.status(400).send('Missing url parameter')

  console.log('Proxy request:', targetUrl)
  followProxy(targetUrl, req.headers, 5, (err, proxyRes, finalUrl) => {
    if (err) {
      console.error('Proxy error:', err.message, 'for', targetUrl)
      return res.status(502).send('Proxy error: ' + err.message)
    }

    const ct = proxyRes.headers['content-type'] || 'unknown'
    console.log('Proxy response:', proxyRes.statusCode, ct, finalUrl)

    const finalUrlObj = new URL(finalUrl)
    const shouldRewrite = isM3U8Response(proxyRes, finalUrlObj) && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300

    if (shouldRewrite) {
      let body = ''
      proxyRes.setEncoding('utf8')
      proxyRes.on('data', chunk => { body += chunk })
      proxyRes.on('end', () => {
        res.status(proxyRes.statusCode)
        Object.entries(proxyRes.headers).forEach(([key, value]) => {
          if (key === 'content-length' || key === 'content-encoding') return
          if (value !== undefined) res.setHeader(key, value)
        })
        res.setHeader('content-type', 'application/vnd.apple.mpegurl')
        res.send(rewriteM3U8(body, finalUrl))
      })
      proxyRes.on('error', (err) => {
        console.error('M3U8 read error:', err.message)
        res.status(502).send('Proxy read error: ' + err.message)
      })
      return
    }

    // Обычное проксирование (EPG, .ts сегменты и т.д.)
    res.status(proxyRes.statusCode)
    Object.entries(proxyRes.headers).forEach(([key, value]) => {
      if (value !== undefined) res.setHeader(key, value)
    })
    proxyRes.pipe(res)
  })
})

// Статика из dist/
app.use(express.static(path.join(__dirname, 'dist')))

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
