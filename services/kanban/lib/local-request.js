const hostnameOf = (value) => {
  const host = String(value || '').replace(/^https?:\/\//i, '').split('/')[0]
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(1, end)
  }
  return host.replace(/:\d+$/, '')
}

const allowedHost = (host) => host === 'localhost' || host === '127.0.0.1' || host === '::1'
  || /^10(\.\d{1,3}){3}$/.test(host)
  || /^192\.168(\.\d{1,3}){2}$/.test(host)
  || /^172\.(1[6-9]|2\d|3[0-1])(\.\d{1,3}){2}$/.test(host)

const isLocalRequest = (request) => {
  const host = hostnameOf(request.headers.host)
  const origin = request.headers.origin ? hostnameOf(request.headers.origin) : ''
  const address = request.socket.remoteAddress
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
  const forwardedHost = request.headers['x-forwarded-host']
  const forwardedProto = request.headers['x-forwarded-proto']
  if (loopback && forwardedHost && ['http', 'https'].includes(forwardedProto)) {
    return !request.headers.origin || request.headers.origin === `${forwardedProto}://${forwardedHost}`
  }
  return allowedHost(host) && (!origin || allowedHost(origin))
}

module.exports = isLocalRequest
