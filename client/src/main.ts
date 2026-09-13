import {Network} from './network';
import {Game} from './game';
import {loadSettings} from './settings';
import {UI} from './ui';
import {MenuScene} from './menu-scene';
import {MenuMusic} from './menu-music';
import {setLoading} from './loading-screen';
import './style.css';
import './menu.css';
import './fixes.css';
const net=new Network(),settings=loadSettings();
const music=new MenuMusic(()=>settings);
let game:Game|undefined;
const ui=new UI(net,settings,s=>{if(game)game.settings=s;music.sync();},()=>game?.enter());
try{game=new Game(document.querySelector('#game')!,net,settings);}catch{ui.message('A browser with WebGL support is required to play. Enable hardware acceleration and reload.');}
try{const menu=new MenuScene(document.querySelector('#menu-scene')!);void Promise.race([menu.ready,new Promise(resolve=>setTimeout(resolve,8000))]).finally(()=>document.body.classList.add('app-ready'));}catch{document.body.classList.add('app-ready');ui.message('The menu character could not be displayed.');}
let downloadingMapId:string|undefined;
net.addEventListener('state',()=>{
  if(!net.state)return;const state=net.state;
  if(state.phase==='waiting'){game?.update(state);return;}
  if(game&&game.loadedMapId!==state.mapId){
    // Show the full-screen bar for the map fetch itself — the slowest part
    // for large maps — not just the local bake that starts once it lands.
    if(downloadingMapId!==state.mapId){
      downloadingMapId=state.mapId;
      setLoading(true,'DOWNLOADING MAP DATA',2);
      void net.ensureMap(state.mapId,fraction=>setLoading(true,'DOWNLOADING MAP DATA',2+fraction*46))
        .then(()=>game?.update(state))
        .catch(error=>{downloadingMapId=undefined;setLoading(false);ui.message((error as Error).message);});
    }
    return;
  }
  downloadingMapId=undefined;
  // The prep countdown is held server-side until the host's client reports it
  // finished loading; show that as a full-screen wait, not a small HUD banner.
  if(state.phase==='prep'&&state.reason.startsWith('Waiting for the host'))setLoading(true,'WAITING FOR HOST TO FINISH LOADING…',100);
  game?.update(state);
});
net.addEventListener('left',()=>game?.reset());
