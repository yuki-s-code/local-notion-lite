import type { WebLocalFileSource, WebProject } from "./types";

const textDecoder = new TextDecoder("utf-8");
const safeName = (value:string) => value.replace(/\.[^.]+$/, "").trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "local-file";

export function parseCsv(text:string):Record<string,string>[] {
  const rows:string[][]=[];
  let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(char==='"')quoted=false;
      else cell+=char;
    }else if(char==='"')quoted=true;
    else if(char===','){row.push(cell);cell="";}
    else if(char==='\n'){row.push(cell.replace(/\r$/, ""));rows.push(row);row=[];cell="";}
    else cell+=char;
  }
  if(cell.length||row.length){row.push(cell.replace(/\r$/, ""));rows.push(row);}
  const meaningful=rows.filter(item=>item.some(value=>value.trim()));
  if(!meaningful.length)return [];
  const headers=meaningful[0].map((header,index)=>header.trim()||`column${index+1}`);
  return meaningful.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??""])));
}

function normalizeJson(value:unknown):Record<string,unknown>[] {
  if(Array.isArray(value))return value.map((item,index)=>item&&typeof item==="object"&&!Array.isArray(item)?item as Record<string,unknown>:{value:item,index:index+1});
  if(value&&typeof value==="object")return [value as Record<string,unknown>];
  return [{value}];
}

export async function readLocalWebFile(file:File):Promise<WebLocalFileSource>{
  if(file.size>1_500_000)throw new Error("ローカルファイルは1.5MB以下にしてください");
  const extension=file.name.split(".").pop()?.toLowerCase();
  if(!extension||!["json","csv","html","htm"].includes(extension))throw new Error("JSON・CSV・HTMLファイルだけ読み込めます");
  const buffer=await file.arrayBuffer();
  const rawText=textDecoder.decode(buffer).replace(/^\uFEFF/,"");
  const format:WebLocalFileSource["format"]=extension==="json"?"json":extension==="csv"?"csv":"html";
  let records:Record<string,unknown>[]=[];
  if(format==="json")records=normalizeJson(JSON.parse(rawText));
  if(format==="csv")records=parseCsv(rawText);
  return {id:`local:${Date.now()}:${Math.random().toString(36).slice(2,8)}`,name:safeName(file.name),fileName:file.name,format,rawText,records,createdAt:Date.now(),size:file.size};
}

export function localSourceTag(source:WebLocalFileSource){return `<ln-local-source name="${source.name}"></ln-local-source>`}

export function localSourceBindingKeys(source:WebLocalFileSource){
  const first=source.records[0]??{};
  return Object.entries(first).filter(([,value])=>value==null||["string","number","boolean"].includes(typeof value)).map(([key,value])=>({key:`file.${source.name}.${key}`,value:value==null?"":String(value)}));
}

export function addLocalSource(project:WebProject,source:WebLocalFileSource):Partial<WebProject>{
  const previous=project.localFileSources??[];
  const existing=previous.find(item=>item.name===source.name);
  const sources=existing?previous.map(item=>item.name===source.name?source:item):[source,...previous];
  return {localFileSources:sources};
}
