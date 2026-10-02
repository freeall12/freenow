// Coordinates and camera values observed in TapNow's default example scene.
window.STUDIO_DEFAULT = {
  version:1, ground:{y:-1.7,size:20,grid:true,room:false}, environment:{background:'none',azimuth:0,intensity:1},
  viewer:{position:[-8.1509,-.1227,4.2224],rotation:[0,-.92,0],order:'YXZ',focal:24,aspect:16/9},
  objects:[
    {id:'cube-1',kind:'cube',name:'立方体',position:[0,-1.7,0],rotation:[0,0,0],scale:[.5,.5,.5],color:'#eeeeee'},
    {id:'tree-1',kind:'tree',name:'树',position:[-.0585,-1.7,-3.0254],rotation:[-Math.PI,-.70063,-Math.PI],scale:[1.3333,1.3333,1.3333]},
    {id:'actor-1',kind:'actor',name:'角色',position:[.0296,-1.7,-2.3471],rotation:[-Math.PI,-.25793,-Math.PI],scale:[1,1,1],color:'#6F93C8',pose:'Sitting Floor'},
    {id:'actor-2',kind:'actor',name:'角色 2',position:[-.0029,-1.6701,.0413],rotation:[0,.33213,0],scale:[1.0882,1.0882,1.0882],color:'#C97984',pose:'Sitting'},
    {id:'camera-1',kind:'camera',name:'摄像机 1',position:[-1.3292,-1.3351,-3.7746],rotation:[3.00476,-.53078,3.07201],scale:[1,1,1],fov:41.1878,aspect:1.5,focal:31.9358,color:'#D0A552'},
    {id:'camera-2',kind:'camera',name:'摄像机 2',position:[-.9669,-.5685,1.2376],rotation:[-.07752,-.46324,-.03469],scale:[1,1,1],fov:34.6662,aspect:16/9,focal:32.4416,color:'#6F93C8'},
    {id:'camera-3',kind:'camera',name:'摄像机 3',position:[-1.3075,-.5367,1.0314],rotation:[-.17659,-.41683,-.07212],scale:[1,1,1],fov:9.9744,aspect:16/9,focal:116.028,color:'#82AD6B'},
    {id:'camera-4',kind:'camera',name:'摄像机 4',position:[-2.2718,-1.1985,-3.818],rotation:[3.03066,-.61535,3.07738],scale:[1,1,1],fov:14.8343,aspect:16/9,focal:77.7759,color:'#A681C8'}
  ],keyframes:[],captures:[]
};
window.STUDIO_POSES = {'站立':'Standing','椅坐':'Sitting','地坐':'Sitting Floor','蹲伏':'Crouching','单膝跪地':'Kneeling','侧卧':'Sleeping Side','自然仰卧':'Sleeping Supine','趴卧':'Lying Prone','伸展仰卧':'Sleeping Supine Straight','行走':'Walking','跑步':'Running'};
