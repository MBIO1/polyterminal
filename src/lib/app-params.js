// Parse app bootstrap params from the current URL
const params = new URLSearchParams(window.location.search);

export const appParams = {
  appId: params.get('app_id') || import.meta.env.VITE_BASE44_APP_ID || 'c8d42feec2f84be1baa9f06400b2509f',
  // Never read access tokens from URL params — tokens must come from the auth session only
  token: '',
  dataEnv: params.get('base44_data_env') || 'prod',
  serverUrl: 'https://polytrade.base44.app',
};