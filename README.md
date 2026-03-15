# webOS 4.0 DLNA 浏览播放器

该项目实现了更接近 LG webOS 自带播放器的使用流程：

- 扫描局域网 DLNA/UPnP MediaServer
- 展示服务器列表
- 浏览目录（容器 / 媒体项）
- 直接播放选择的媒体资源
- 支持外挂字幕 URL（`.vtt` / `.srt` 自动转 VTT）

## 功能说明

1. 点击 **扫描 DLNA 服务器**，通过 webOS Luna 服务发现局域网媒体服务器。  
2. 在左侧选择服务器，右侧展示目录。  
3. 点击文件夹进入，点击媒体项播放。  
4. 可输入字幕 URL 并应用到当前播放媒体。

## 运行要求

- 建议在 webOS TV 应用环境运行（需要 `window.webOS.service.request`）
- DLNA 服务器需允许设备访问其描述文件与媒体 URL
- 若外挂字幕跨域失败，请在字幕服务器开启 CORS

## 打包

```bash
ares-package .
```
