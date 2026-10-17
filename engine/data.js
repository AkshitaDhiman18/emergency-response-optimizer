// SIMULATED demo data (not real roads, ambulances or hospitals). One coordinate system: WGS84 lat/lng.
const SPEED = { highway: 60, main: 40, local: 25 }; // km/h assumptions per road class
const NODES = { n1:['Cantt Chowk',30.375,76.821], n2:['City Bus Stand',30.378,76.777], n3:['Sector 7 Crossing',30.355,76.790],
 n4:['Railway Overbridge',30.368,76.800], n5:['GT Road East',30.385,76.845], n6:['Mullana Campus Gate',30.330,76.830],
 n7:['Industrial Area',30.345,76.760], n8:['Highway Junction',30.340,76.800], n9:['Model Town',30.395,76.800],
 n10:['Bypass North',30.405,76.830], n11:['Ring Road South',30.320,76.790], n12:['Market Square',30.362,76.775] };
const EDGES = [['e1','n1','n4','main','Cantt Link'],['e2','n4','n2','main','Overbridge Road'],['e3','n4','n3','main','Station Road'],
 ['e4','n3','n12','local','Sector 7 Lane'],['e5','n12','n2','local','Market Road'],['e6','n1','n5','highway','GT Road West'],
 ['e7','n5','n10','highway','GT Road North'],['e8','n10','n9','main','Bypass Link'],['e9','n9','n4','main','Model Town Road'],
 ['e10','n9','n2','main','Bus Stand Road'],['e11','n3','n8','main','Highway Feeder'],['e12','n8','n6','main','Campus Road'],
 ['e13','n6','n1','main','Campus-Cantt Road'],['e14','n8','n11','local','Ring Road A'],['e15','n11','n7','local','Ring Road B'],
 ['e16','n7','n12','main','Industrial Road'],['e17','n7','n8','local','Factory Lane'],['e18','n6','n3','local','Hostel Lane'],['e19','n11','n6','local','South Link']];
function haversine(a, b) { const r = x => x*Math.PI/180, dL = r(b.lat-a.lat), dN = r(b.lng-a.lng);
  const h = Math.sin(dL/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dN/2)**2; return 2*6371*Math.asin(Math.sqrt(h)); }
function makeGraph() {
  const nodes = {}; for (const [id,[name,lat,lng]] of Object.entries(NODES)) nodes[id] = { id, name, lat, lng };
  const edges = EDGES.map(([id,a,b,cls,name]) => ({ id, a, b, cls, name, speed: SPEED[cls],
    km: Math.round(haversine(nodes[a], nodes[b])*1.25*100)/100, // 1.25 = road winding factor
    blocked: false, factor: 1 })); // factor: 1 normal, 0.5 congestion (half speed)
  return { nodes, edges };
}
const R = (id,name,caps,node,speed,status,note) => ({ id, name, capabilities: caps, node, speed, status, assignedTo: status==='busy' ? 'External duty (simulated)' : null, note: note||'' });
const makeResponders = () => [
  R('AMB-01','Advanced Life Support 1',['ALS','BLS'],'n2',1.0,'available'),
  R('AMB-02','Basic Life Support 1',['BLS'],'n1',1.1,'available'),
  R('AMB-03','Cardiac ALS Unit',['ALS','BLS','CARDIAC'],'n8',1.0,'available'),
  R('TRM-01','Trauma Unit',['TRAUMA','ALS','BLS'],'n6',0.9,'available'),
  R('FIRE-01','Fire Engine 1',['FIRE','RESCUE'],'n7',1.0,'available'),
  R('FIRE-02','Fire Engine 2',['FIRE','RESCUE'],'n10',1.0,'busy','Standby duty'),
  R('AMB-04','Basic Life Support 2',['BLS'],'n11',1.0,'busy','Routine transfer'),
  R('AMB-05','Advanced Life Support 2',['ALS','BLS'],'n9',1.0,'unavailable','Crew change') ];
const H = (id,name,caps,node,avail,total,status) => ({ id, name, capabilities: caps, node, available: avail, total, status });
const makeHospitals = () => [
  H('H-CIVIL','City Civil Hospital',['EMERGENCY','TRAUMA'],'n2',4,20,'open'),
  H('H-HEART','Cantt Heart Institute',['EMERGENCY','CARDIAC'],'n1',2,15,'open'),
  H('H-MMU','Mullana Medical College',['EMERGENCY','TRAUMA','CARDIAC','BURN'],'n6',0,30,'open'),
  H('H-ESI','Industrial ESI Hospital',['EMERGENCY','BURN'],'n7',3,10,'open'),
  H('H-NBT','North Burn & Trauma Centre',['EMERGENCY','TRAUMA','BURN'],'n10',5,12,'open') ];
const SEED_INCIDENTS = [
  { type:'road_accident', node:'n4', people:3, description:'Two vehicle collision on the overbridge', symptoms:'driver unconscious, bleeding' },
  { type:'cardiac', node:'n12', people:1, description:'Elderly man in market with sudden pain', symptoms:'chest pain, sweating' },
  { type:'fire', node:'n7', people:6, description:'Factory fire spreading across the shed', symptoms:'workers with smoke inhalation, burn injuries' },
  { type:'injury', node:'n6', people:1, description:'Student fell from hostel stairs', symptoms:'suspected fracture' },
  { type:'other', node:'n11', people:1, description:'Person collapsed', symptoms:'' } ];
const CONFIG = {
  prio: { base:{road_accident:40,cardiac:60,fire:50,injury:30,other:15}, perPerson:4, maxPeople:10,
    keywords:{'unconscious':25,'not breathing':30,'no pulse':30,'collapsed':20,'chest pain':15,'bleeding':15,'trapped':15,'explosion':20,
      'spreading':12,'child':8,'elderly':6,'pregnan':8,'burn':10,'smoke':6,'seizure':10,'fracture':6,'head injury':12,'collision':5},
    thresholds:{ Critical:75, High:55, Medium:35 } }, // score 0-100 -> level
  alloc: { respEta:{Critical:.8,High:.7,Medium:.6,Low:.5}, etaPenaltyPerMin:{Critical:5,High:4,Medium:3,Low:2},
    hosp:{ cap:.4, eta:.35, capacity:.25 } } };
module.exports = { makeGraph, makeResponders, makeHospitals, SEED_INCIDENTS, CONFIG, haversine };
