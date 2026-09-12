import { defineConfig } from 'vite';
const serverTarget=process.env.DEV_SERVER_TARGET??'http://127.0.0.1:2567';
export default defineConfig({server:{port:5173, proxy:{'/api':serverTarget,'/socket':{target:serverTarget,ws:true,rewrite:p=>p.replace(/^\/socket/,'')}}},build:{target:'es2022'}});
