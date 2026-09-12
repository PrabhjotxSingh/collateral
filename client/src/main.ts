import {Network} from './network';
import {Game} from './game';
import {loadSettings} from './settings';
import {UI} from './ui';
import {MenuScene} from './menu-scene';
import {MenuMusic} from './menu-music';
import './style.css';
import './menu.css';
const net=new Network(),settings=loadSettings();
const music=new MenuMusic(()=>settings);
let game:Game|undefined;
const ui=new UI(net,settings,s=>{if(game)game.settings=s;music.sync();},()=>game?.enter());
try{game=new Game(document.querySelector('#game')!,net,settings);}catch{ui.message('A browser with WebGL support is required to play. Enable hardware acceleration and reload.');}
try{const menu=new MenuScene(document.querySelector('#menu-scene')!);void Promise.race([menu.ready,new Promise(resolve=>setTimeout(resolve,8000))]).finally(()=>document.body.classList.add('app-ready'));}catch{document.body.classList.add('app-ready');ui.message('The menu character could not be displayed.');}
net.addEventListener('state',()=>{if(net.state)game?.update(net.state);});
net.addEventListener('left',()=>game?.reset());
