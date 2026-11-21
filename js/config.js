/* 店家設定：API 位址、LINE LIFF ID、LINE 官方帳號 ID */
window.NTC_CONFIG = {
  api: 'https://n7tzxjzhjty5cngobe4wy7zlxe0efyyj.lambda-url.ap-northeast-1.on.aws',
  liffId: '2012677349-KI6PM6Pz', // LINE Login channel 2012677349（N.T Cookie × Canelé）
  lineId: '@ntcookie',
  base: '',
  home: 'index.html',
  cookiePhotoSize: 900,
  cookiePhotoBackground: '#FAD7DC', // 造型餅乾單片固定粉紅底
  version: '2026-11-22 V10.1', // 每次上版改這裡，後台最下面會顯示
};

document.documentElement.style.setProperty('--cookie-photo-background', window.NTC_CONFIG.cookiePhotoBackground);
