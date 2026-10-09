export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export async function readJson(response, limit=8192) {
  if (Number(response.headers.get('content-length'))>limit) throw new ApiError(413,'PAYLOAD_TOO_LARGE','The request is too large.');
  if (!response.body) throw new ApiError(400,'INVALID_JSON','A JSON body is required.');
  const reader=response.body.getReader(); const chunks=[]; let size=0;
  try { while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>limit){await reader.cancel(); throw new ApiError(413,'PAYLOAD_TOO_LARGE','The request is too large.');} chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0; for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ApiError(400,'INVALID_JSON','The request must contain valid JSON.');}
}
