export type DiffLine={type:'same'|'added'|'removed';text:string};
export function buildLineDiff(before:string,after:string):DiffLine[]{
 const a=before.split(/\r?\n/),b=after.split(/\r?\n/); const dp=Array.from({length:a.length+1},()=>Array<number>(b.length+1).fill(0));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
 const out:DiffLine[]=[];let i=0,j=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){out.push({type:'same',text:a[i++]});j++;}else if(dp[i+1][j]>=dp[i][j+1])out.push({type:'removed',text:a[i++]});else out.push({type:'added',text:b[j++]});}while(i<a.length)out.push({type:'removed',text:a[i++]});while(j<b.length)out.push({type:'added',text:b[j++]});return out;
}
