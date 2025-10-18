const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
(async ()=>{
  const form = new FormData();
  form.append('image', fs.createReadStream('test.png'));
  try{
    const res = await fetch('http://localhost:3000/upload-image?cardId=test123', { method:'POST', body: form, headers: form.getHeaders() });
    const text = await res.text();
    console.log('status', res.status);
    console.log('body', text);
  }catch(e){ console.error('err', e.message); }
})();
