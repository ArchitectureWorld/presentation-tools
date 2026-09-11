import { readFile } from 'node:fs/promises'
// OPC scaffolding generated with PptxGenJS 4.0.0 (MIT). No fonts, executable code or binary assets are bundled.
const header='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const relBase='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const rels=rows=>header+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id,type,target])=>`<Relationship Id="${id}" Type="${relBase+type}" Target="${target}"/>`).join('')}</Relationships>`
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
/** Stored ZIP with CRCs. Bounded caller-supplied package entries; no path/extraction API. */
function zip(entries){
 const locals=[],central=[];let offset=0
 for(const [path,value] of entries){const name=Buffer.from(path),data=Buffer.isBuffer(value)?value:Buffer.from(value),crc=crc32(data),local=Buffer.alloc(30),directory=Buffer.alloc(46)
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26)
  directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(33,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42)
  locals.push(local,name,data);central.push(directory,name);offset+=local.length+name.length+data.length
 }
 const centralBytes=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16)
 return Buffer.concat([...locals,centralBytes,end])
}
export async function createImagePptx({canvas,pages}){
 const template=JSON.parse(await readFile(new URL('./opc-template.json',import.meta.url),'utf8')),cx=Math.round(canvas.width*9525),cy=Math.round(canvas.height*9525)
 const entries=Object.entries(template)
 const overrides=[['/ppt/presentation.xml','presentation'],['/ppt/slideMasters/slideMaster1.xml','slideMaster'],['/ppt/slideLayouts/slideLayout1.xml','slideLayout'],['/ppt/theme/theme1.xml','theme'],...pages.map((_,i)=>[`/ppt/slides/slide${i+1}.xml`,'slide'])]
 entries.push(['[Content_Types].xml',header+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.map(([part,type])=>`<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type==='theme'?'theme':`presentationml.${type==='presentation'?'presentation.main':type}`}+xml"/>`).join('')}</Types>`])
 entries.push(['_rels/.rels',rels([['rId1','officeDocument','ppt/presentation.xml']])])
 entries.push(['ppt/_rels/presentation.xml.rels',rels([['rId1','slideMaster','slideMasters/slideMaster1.xml'],...pages.map((_,i)=>[`rId${i+2}`,'slide',`slides/slide${i+1}.xml`])])])
 entries.push(['ppt/presentation.xml',header+`<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relBase.slice(0,-1)}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${pages.map((_,i)=>`<p:sldId id="${256+i}" r:id="rId${i+2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`])
 for(const [i,p] of pages.entries()){
  const n=i+1
  entries.push([`ppt/media/page${n}.png`,p.png])
  entries.push([`ppt/slides/_rels/slide${n}.xml.rels`,rels([['rId1','slideLayout','../slideLayouts/slideLayout1.xml'],['rId2','image',`../media/page${n}.png`]])])
  entries.push([`ppt/slides/slide${n}.xml`,header+`<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relBase.slice(0,-1)}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Verified preview ${n}" descr="Image-based checked layout. Edit the accompanying Studio source for object-level changes."/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`])
 }
 return zip(entries)
}
