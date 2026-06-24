# RiskBird Company Enricher

本地 Chrome 扩展：读取 BOSS Lead Collector 导出的 CSV，在风鸟页面逐个搜索公司，并把页面可见的公开联系方式补回 CSV。

## 安装

1. 打开 Chrome：`chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择这个文件夹：
   `D:\CODEX项目\短信获客项目\chrome-extension\riskbird-company-enricher`

## 使用

1. 打开并登录风鸟：`https://www.riskbird.com/`
2. 点击扩展按钮
3. 上传 BOSS 导出的 CSV
4. 点击「开始补全」
5. 保持风鸟标签页打开，插件会逐个搜索公司
6. 完成后自动下载补全 CSV
7. 中途需要停止时，点击「停止并导出当前结果」，会立即下载已补全部分

## 输出

保留原 BOSS 字段，并补充：

- `riskbirdMatchedCompanyName`
- `riskbirdCompanyPhones`
- `riskbirdEmails`
- `riskbirdWebsite`
- `riskbirdHasPublicMobile`
- `riskbirdMobileNumbers`
- `riskbirdSourceUrl`
- `riskbirdStatus`
- `riskbirdNote`

## 合规边界

扩展只读取风鸟页面可见内容，不读取 Cookie，不绕过验证码，不自动发送短信。公开手机号只保存掩码。
