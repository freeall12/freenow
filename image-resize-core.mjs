export const maxDimension=20000;
export const maxPixels=128*1024*1024;
export const sourceOf=node=>node?.fullImage||node?.image;
export function dimensions(width,height){return {width:Number.parseInt(width,10),height:Number.parseInt(height,10)};}
export function validate(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>maxDimension||height>maxDimension)return '请输入合法的正整数，1～20000 之间的整数（单位：像素）';
 if(width*height>maxPixels)return '总像素超出安全上限，请减小宽度或高度。';
 return null;
}
export function linkedDimension(value,numerator,denominator){const n=Number.parseInt(value,10);return n>0&&numerator>0&&denominator>0?String(Math.max(1,Math.round(n*numerator/denominator))):null;}
export function distorted(original,width,height){if(!original.width||!original.height||width<=0||height<=0)return false;const ratio=(width/height)/(original.width/original.height);return Math.max(ratio,1/ratio)>2.5;}
export function nodeSize(width,height){const ratio=width/height;return {width:Math.round(250*Math.max(1,ratio)),height:Math.round(250*Math.max(1,1/ratio))};}
export function panelPosition(node,view){return {left:(node.x+node.width/2-180)*view.scale+view.x,top:(node.y+node.height+12)*view.scale+view.y,scale:view.scale};}
export function openingView(node,width,height){return {scale:.9,x:width/2-(node.x+node.width/2)*.9,y:height/2-(node.y+node.height/2+120)*.9};}
