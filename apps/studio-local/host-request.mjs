export function assertDesignHostRequest(request) {
 const headers=request.headers??{}
 if(request.method!=='POST'||headers.origin!==`http://${headers.host}`||headers['sec-fetch-site']!=='same-origin'||!String(headers['content-type']).startsWith('application/json'))throw Object.assign(new Error('写入必须由同源宿主界面提交。'),{code:'design_scope_denied',status:403})
}
