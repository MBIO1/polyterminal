// Parse app bootstrap params from the current URL
const params = new URLSearchParams(window.location.search);

// For Vercel deployment, use hardcoded values or env vars
export const appParams = {
  appId: params.get('app_id') || import.meta.env.VITE_BASE44_APP_ID || 'c8d42feec2f84be1baa9f06400b2509f',
  token: params.get('access_token') || '',
  dataEnv: params.get('base44_data_env') || 'prod',
  serverUrl: params.get('server_url') || 'https://polytrade.base44.app',
};
