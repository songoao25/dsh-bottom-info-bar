// Bottom Info Bar（底部信息栏插件）— client 设置页扩展（与 client-bundle.js 同一 bundle 作用域拼接）
// v1.9.0 PR2：注册 DSH 设置面板 settings.section 插座，新增「信息底栏」设置页。
// 约定：本文件与 client-bundle.js 拼接进同一个 __ModuleLoader__ factory 作用域，
// 顶层标识符一律使用 InfoBarSettings*/bibSet* 前缀，绝不与主包重名（React/rpc 等直接复用主包声明）。
'use strict';

// 注册入口：在信息栏 apply 完成后调用（见文件尾部的 module.exports 包装）。
async function applyInfoBarSettingsSection(ctx) {
  let slots = ctx.slots || (ctx.get ? ctx.get('slots') : undefined);
  for (let i = 0; slots === undefined && i < 60; i++) {
    await new Promise(function (resolve) { window.setTimeout(resolve, 300); });
    slots = ctx.slots || (ctx.get ? ctx.get('slots') : undefined);
  }
  if (slots === undefined) {
    console.warn('[dsh-bottom-info-bar] slots 服务 18s 内未就绪，信息底栏设置页未注册');
    return;
  }
  void slots;
}

// ---- 设置页扩展：包装模块导出，在信息栏 apply 完成后注册 settings.section ----
;(function () {
  const baseExports = module.exports;
  module.exports = {
    inject: baseExports.inject,
    apply: async function (ctx) {
      await baseExports.apply(ctx);
      await applyInfoBarSettingsSection(ctx);
    },
  };
})();
