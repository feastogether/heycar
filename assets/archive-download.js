(function(){
 'use strict';
 const encoder=new TextEncoder(),table=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 const crc=(value,bytes)=>{for(const b of bytes)value=table[(value^b)&255]^(value>>>8);return value>>>0;};
 const segment=value=>String(value||'未指定').replace(/[\u0000-\u001f<>:"/\\|?*]/g,'_').replace(/^\.+|[. ]+$/g,'').slice(0,120)||'未指定';
 const header=(length,signature)=>{const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);view.setUint32(0,signature,true);return {bytes,view};};
 async function save(name,prepare,onProgress=()=>{}){
  let sink=null;const parts=[];let offset=0,buffered=0;const directory=[];
  if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:segment(name)+'.zip',types:[{description:'ZIP 壓縮檔',accept:{'application/zip':['.zip']}}]});sink=await handle.createWritable();}
  const write=async bytes=>{if(offset+bytes.length>0xffffffff)throw Error('此批超過ZIP容量上限，請分批匯出');if(sink)await sink.write(bytes);else{buffered+=bytes.length;if(buffered>200*1024*1024)throw Error('此瀏覽器不支援直接寫入磁碟；超過200 MB請使用桌面版Chrome或Edge下載');parts.push(bytes);}offset+=bytes.length;};
  try{const files=await prepare();if(files.length>65535)throw Error('檔案過多，請分批');
   for(let index=0;index<files.length;index++){
    const file=files[index],filename=encoder.encode(file.name.split('/').map(segment).join('/')),start=offset,local=header(30,0x04034b50);local.view.setUint16(4,20,true);local.view.setUint16(6,0x808,true);local.view.setUint16(12,33,true);local.view.setUint16(26,filename.length,true);await write(local.bytes);await write(filename);let checksum=0xffffffff,size=0;
    const add=async bytes=>{checksum=crc(checksum,bytes);size+=bytes.length;await write(bytes);};
    if(file.text!==undefined)await add(encoder.encode(file.text));else{const response=await fetch(file.url);if(!response.ok)throw Error('照片讀取失敗：'+file.name);const reader=response.body.getReader();for(;;){const item=await reader.read();if(item.done)break;await add(item.value);}}
    checksum=(checksum^0xffffffff)>>>0;const desc=header(16,0x08074b50);desc.view.setUint32(4,checksum,true);desc.view.setUint32(8,size,true);desc.view.setUint32(12,size,true);await write(desc.bytes);
    directory.push({filename,start,checksum,size});onProgress(index+1,files.length);
   }
   const centralStart=offset;
   for(const file of directory){const h=header(46,0x02014b50);h.view.setUint16(4,20,true);h.view.setUint16(6,20,true);h.view.setUint16(8,0x808,true);h.view.setUint16(14,33,true);h.view.setUint32(16,file.checksum,true);h.view.setUint32(20,file.size,true);h.view.setUint32(24,file.size,true);h.view.setUint16(28,file.filename.length,true);h.view.setUint32(42,file.start,true);await write(h.bytes);await write(file.filename);}
   const end=header(22,0x06054b50);end.view.setUint16(8,directory.length,true);end.view.setUint16(10,directory.length,true);end.view.setUint32(12,offset-centralStart,true);end.view.setUint32(16,centralStart,true);await write(end.bytes);
   if(sink)await sink.close();else{const url=URL.createObjectURL(new Blob(parts,{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=segment(name)+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
   return {files:directory.length,bytes:offset};
  }catch(error){if(sink)await sink.abort().catch(()=>{});throw error;}
 }
 window.HeycarArchive={save,segment};
})();
