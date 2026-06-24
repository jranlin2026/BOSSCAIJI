# BOSS Lead Collector

本地 Chrome 扩展，用于在已登录的 BOSS 直聘搜索结果页采集可见岗位卡。

## 安装

1. 打开 Chrome：`chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择这个文件夹：
   `D:\CODEX项目\短信获客项目\chrome-extension\boss-lead-collector`

## 使用

1. 打开 BOSS 直聘并登录
2. 搜索目标岗位，例如：
   - `SaaS销售`
   - `软件销售`
   - `AI销售`
   - `渠道销售`
   - `CRM销售`
   - `电商运营`
   - `直播运营`
3. 点击浏览器右上角扩展按钮
4. 点击「开始采集」
5. 等待页面自动滚动，结束后会下载 CSV

## 导出字段

- `companyName`
- `jobName`
- `jobUrl`
- `pageUrl`
- `evidence`
- `collectedAt`

## 合规边界

扩展只读取当前页面可见的招聘卡信息，不读取 Cookie，不自动沟通，不发短信，不绕过验证码。
