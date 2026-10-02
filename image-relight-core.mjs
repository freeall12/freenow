export const brightnessStops=[10,50,100];
export const temperatureStops=[2000,3000,4000,5600,7000,8000];
export const temperatureColors=['#D7995D','#D5AE55','#F3DB90','#F3F9FC','#D4E6EE','#C4E2F0'];
export const azimuthStops=[0,45,90,135,180,225,270,315],elevationStops=[-90,-45,0,45,90];
const keys=[['front_0','right_45','right_90','right_rear_45','back_180','left_rear_45','left_90','left_45'],['top_front_45','top_front_right_45','top_right_45','right_rear_top_45','top_rear_45','left_rear_top_45','top_left_45','top_front_left_45'],['bottom_front_45','bottom_front_right_45','bottom_right_45','right_rear_bottom_45','bottom_rear_45','left_rear_bottom_45','bottom_left_45','bottom_front_left_45']];
export const anglePresets=keys.flatMap((row,i)=>row.map((key,j)=>({key,azimuthDeg:j*45,elevationDeg:[0,45,-45][i]}))).concat([{key:'top_90',azimuthDeg:0,elevationDeg:90},{key:'bottom_90',azimuthDeg:0,elevationDeg:-90}]);
export const buttons=[['left_90','左侧'],['top_90','顶部'],['right_90','右侧'],['front_0','前方'],['bottom_90','底部'],['back_180','后方']].map(([key,label])=>({...anglePresets.find(p=>p.key===key),label}));
export const rimPresets={back_0:{azimuthDeg:180,elevationDeg:0},top_back_45:{azimuthDeg:180,elevationDeg:45},low_back_45:{azimuthDeg:180,elevationDeg:-45}};
export const defaults=Object.freeze({angle:Object.freeze({preset:'front_0',azimuthDeg:0,elevationDeg:0}),brightnessLevel:50,temperatureK:5600,rimEnabled:true,rimPreset:'back_0'});
const norm=v=>(v%360+360)%360,distance=(a,b)=>Math.abs((norm(a)-norm(b)+540)%360-180),finite=(v,f)=>Number.isFinite(v)?v:f;
const nearest=(value,list,circular=false)=>list.reduce((best,v)=>(circular?distance(value,v):Math.abs(value-v))<(circular?distance(value,best):Math.abs(value-best))?v:best,list[0]);
export function findPreset(az,el){if(Math.abs(el-90)<=5)return anglePresets.at(-2);if(Math.abs(el+90)<=5)return anglePresets.at(-1);return anglePresets.find(p=>distance(az,p.azimuthDeg)<=5&&Math.abs(el-p.elevationDeg)<=5)||null;}
export function rimAllowed(az,el){return [[0,0],[270,0],[90,0],[0,90],[0,-90],[0,45],[315,0],[45,0],[315,45],[45,45]].some(([a,e])=>distance(az,a)<=5&&Math.abs(el-e)<=5);}
export function parameters(value={}){const p=anglePresets.find(p=>p.key===(value.angle?.preset??value.anglePreset)),az=finite(value.angle?.azimuthDeg??value.azimuthDeg,p?.azimuthDeg??0),el=finite(value.angle?.elevationDeg??value.elevationDeg,p?.elevationDeg??0);return {angle:{preset:findPreset(az,el)?.key??p?.key??null,azimuthDeg:az,elevationDeg:el},brightnessLevel:brightnessStops.includes(value.brightnessLevel)?value.brightnessLevel:50,temperatureK:temperatureStops.includes(value.temperatureK)?value.temperatureK:5600,rimEnabled:typeof value.rimEnabled==='boolean'?value.rimEnabled:true,rimPreset:Object.hasOwn(rimPresets,value.rimPreset)?value.rimPreset:'back_0'};}
export function setAngle(value,az,el){return {...value,angle:{preset:findPreset(az,el)?.key??null,azimuthDeg:az,elevationDeg:el},rimEnabled:rimAllowed(az,el)&&value.rimEnabled};}
export function dragAngle(az,el,dx,dy,rim=false){return {azimuthDeg:rim?180:az+dx*.8,elevationDeg:Math.min(rim?45:90,Math.max(rim?-45:-90,el-dy*.8))};}
export function snapAngle(az,el){return {azimuthDeg:nearest(norm(az),azimuthStops,true),elevationDeg:nearest(el,elevationStops)};}
export function snapRim(az,el){return Object.keys(rimPresets).reduce((best,key)=>{const p=rimPresets[key],b=rimPresets[best];return distance(az,p.azimuthDeg)+Math.abs(el-p.elevationDeg)<distance(az,b.azimuthDeg)+Math.abs(el-b.elevationDeg)?key:best;},'back_0');}
export function stopIndex(clientX,left,width,count){return Math.min(count-1,Math.max(0,Math.round((clientX-left)/width*(count-1))));}
export function scrubIndex(start,delta,count){return Math.min(count-1,Math.max(0,start+Math.round(delta/20)));}
export function requestParameters(value){const p=parameters(value);if(!p.angle.preset)throw Error('请选择标准光位');return {angle:{preset:p.angle.preset},brightnessPercent:p.brightnessLevel,temperatureK:p.temperatureK,rimEnabled:p.rimEnabled&&rimAllowed(p.angle.azimuthDeg,p.angle.elevationDeg),rimPreset:p.rimPreset};}
export function panelPosition(n,v){return {left:(n.x+n.width/2-301)*v.scale+v.x,top:(n.y+n.height+12)*v.scale+v.y,scale:v.scale};}
export function openingView(n,width,height){return {scale:.9,x:width/2-(n.x+n.width/2)*.9,y:height/2-(n.y+n.height/2+120)*.9};}
