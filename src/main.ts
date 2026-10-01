import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { installApi, captureTokenFromUrl } from './lib/api';

// OAuth 回跳：URL 上的 ?token= 先收进 localStorage（并清掉 query），再挂载 App
captureTokenFromUrl();
installApi();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
