// Parse app bootstrap params from the current URL
const params = new URLSearchParams(window.location.search);

export const appParams = {
  appId: params.get('app_id') || import.meta.env.VITE_BASE44_APP_ID || '',
  token: params.get('access_token') || '',
  dataEnv: params.get('base44_data_env') || 'prod',
  serverUrl: params.get('server_url') || window.location.origin,
};