const express = require('express')
const http = require('http')
const https = require('https')
const { URL } = require('url')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000

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
    // Если строка выглядит как URI (не тег EXT-X)
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

// Прокси для внешних URL
app.use('/proxy', (req, res) => {
  const targetUrl = req.query.url
  if (!targetUrl) return res.status(400).send('Missing url parameter')

  let url
  try {
    url = new URL(targetUrl)
  } catch {
    return res.status(400).send('Invalid url parameter')
  }

  const client = url.protocol === 'https:' ? https : http
  const isM3U8Request =
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.m3u') ||
    (req.headers.accept || '').toLowerCase().includes('mpegurl')

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: req.method,
    headers: { ...req.headers, host: url.host },
  }

  delete options.headers['origin']
  delete options.headers['referer']
  delete options.headers['connection']
  delete options.headers['upgrade-insecure-requests']

  // Для m3u8 не запрашиваем gzip — нам нужен plain text для рерайта
  if (isM3U8Request) {
    delete options.headers['accept-encoding']
  }

  const proxyReq = client.request(options, (proxyRes) => {
    const shouldRewrite = isM3U8Response(proxyRes, url) && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300

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
        res.send(rewriteM3U8(body, targetUrl))
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

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message, 'for', targetUrl)
    res.status(502).send('Proxy error: ' + err.message)
  })

  req.pipe(proxyReq)
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
