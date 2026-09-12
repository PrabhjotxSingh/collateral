import { spawn } from 'node:child_process';
const server=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'2568'}});
let proxy;
let ready=false;
try {
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server did not start')),15000);
    server.stdout.on('data',data=>{if(String(data).includes('listening')){ready=true;clearTimeout(timer);resolve();}});
    server.stderr.on('data',data=>process.stderr.write(data));
    server.on('exit',code=>{clearTimeout(timer);if(!ready)reject(new Error(`Server exited ${code}`));});
  });
  const health=await fetch('http://127.0.0.1:2568/api/health');if(!health.ok)throw new Error('HTTP health failed');
  if(process.env.TEST_PROXY==='1'){
    proxy=spawn(process.execPath,['node_modules/vite/bin/vite.js','client','--host','127.0.0.1','--port','5174','--strictPort'],{stdio:['ignore','pipe','inherit'],env:{...process.env,DEV_SERVER_TARGET:'http://127.0.0.1:2568'}});
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Vite did not start')),10000);proxy.stdout.on('data',data=>{if(String(data).includes('Local:')){clearTimeout(t);resolve();}});});
    const page=await fetch('http://127.0.0.1:5174');if(!(await page.text()).includes('<title>Collateral</title>'))throw new Error('Client page not served');
  }
  const tests=spawn(process.execPath,['--import','tsx','tests/integration.ts'],{stdio:'inherit',env:{...process.env,TEST_SERVER:process.env.TEST_PROXY==='1'?'ws://127.0.0.1:5174/socket':'ws://127.0.0.1:2568'}});
  process.exitCode=await new Promise(resolve=>tests.on('exit',resolve));
}finally{proxy?.kill('SIGTERM');server.kill('SIGTERM');const teardown=setTimeout(()=>server.kill('SIGKILL'),1500);teardown.unref();}
