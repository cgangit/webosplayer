(function () {
  var discoverBtn = document.getElementById("discoverBtn");
  var refreshBtn = document.getElementById("manualRefreshBtn");
  var backBtn = document.getElementById("backBtn");
  var serverList = document.getElementById("serverList");
  var contentList = document.getElementById("contentList");
  var currentPath = document.getElementById("currentPath");
  var subtitleInput = document.getElementById("subtitleUrl");
  var applySubtitleBtn = document.getElementById("applySubtitleBtn");
  var clearSubtitleBtn = document.getElementById("clearSubtitleBtn");
  var player = document.getElementById("player");
  var status = document.getElementById("status");

  var state = {
    servers: [],
    selectedServer: null,
    stack: [],
    objectId: "0"
  };

  function setStatus(text, isError) {
    status.textContent = text;
    status.style.color = isError ? "#ff8b8b" : "#77f4b5";
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function isHttpUrl(url) {
    return /^https?:\/\//i.test(url);
  }

  function clearTracks() {
    var tracks = player.querySelectorAll("track");
    for (var i = 0; i < tracks.length; i += 1) {
      tracks[i].remove();
    }
  }

  function toVtt(srtText) {
    var vttBody = srtText
      .replace(/\r+/g, "")
      .replace(/^\d+$/gm, "")
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2 --> $3.$4");
    return "WEBVTT\n\n" + vttBody.trim() + "\n";
  }

  function applyTrackFromText(vttText, label) {
    clearTracks();
    var blob = new Blob([vttText], { type: "text/vtt" });
    var track = document.createElement("track");
    track.kind = "subtitles";
    track.srclang = "zh";
    track.label = label || "外挂字幕";
    track.default = true;
    track.src = URL.createObjectURL(blob);
    player.appendChild(track);
    setStatus("字幕已加载");
  }

  function loadSubtitleByUrl(url) {
    if (!url) {
      setStatus("未填写字幕 URL", true);
      return;
    }

    if (!isHttpUrl(url)) {
      setStatus("字幕 URL 必须是 HTTP/HTTPS", true);
      return;
    }

    fetch(url)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("字幕下载失败: " + res.status);
        }
        return res.text();
      })
      .then(function (text) {
        var isSrt = /\.srt($|\?)/i.test(url);
        applyTrackFromText(isSrt ? toVtt(text) : text, isSrt ? "外挂字幕(SRT)" : "外挂字幕(VTT)");
      })
      .catch(function (error) {
        setStatus("字幕加载失败: " + error.message, true);
      });
  }

  function parseDeviceDescription(xmlText, location) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlText, "text/xml");
    var friendlyNameNode = doc.querySelector("device > friendlyName");
    var udnNode = doc.querySelector("device > UDN");
    var serviceNodes = doc.querySelectorAll("service");
    var contentDirectoryControlUrl = "";
    var i;

    for (i = 0; i < serviceNodes.length; i += 1) {
      var typeNode = serviceNodes[i].querySelector("serviceType");
      if (typeNode && /ContentDirectory/i.test(typeNode.textContent)) {
        var controlNode = serviceNodes[i].querySelector("controlURL");
        if (controlNode) {
          contentDirectoryControlUrl = controlNode.textContent.trim();
          break;
        }
      }
    }

    if (!contentDirectoryControlUrl) {
      throw new Error("未找到 ContentDirectory 服务");
    }

    var base = new URL(location);
    var controlUrl = new URL(contentDirectoryControlUrl, base).toString();

    return {
      id: (udnNode && udnNode.textContent.trim()) || location,
      name: (friendlyNameNode && friendlyNameNode.textContent.trim()) || "未知服务器",
      location: location,
      controlUrl: controlUrl
    };
  }

  function parseDidlLite(xmlText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlText, "text/xml");
    var containers = doc.getElementsByTagName("container");
    var items = doc.getElementsByTagName("item");
    var result = [];
    var i;

    for (i = 0; i < containers.length; i += 1) {
      result.push({
        type: "container",
        id: containers[i].getAttribute("id") || "",
        parentId: containers[i].getAttribute("parentID") || "",
        title: (containers[i].getElementsByTagName("dc:title")[0] || containers[i].getElementsByTagName("title")[0] || {}).textContent || "目录"
      });
    }

    for (i = 0; i < items.length; i += 1) {
      var resNode = items[i].getElementsByTagName("res")[0];
      result.push({
        type: "item",
        id: items[i].getAttribute("id") || "",
        parentId: items[i].getAttribute("parentID") || "",
        title: (items[i].getElementsByTagName("dc:title")[0] || items[i].getElementsByTagName("title")[0] || {}).textContent || "媒体",
        url: resNode ? resNode.textContent.trim() : ""
      });
    }

    return result;
  }

  function soapBrowse(server, objectId) {
    var body =
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
      "<s:Body>" +
      "<u:Browse xmlns:u=\"urn:schemas-upnp-org:service:ContentDirectory:1\">" +
      "<ObjectID>" + escapeXml(objectId) + "</ObjectID>" +
      "<BrowseFlag>BrowseDirectChildren</BrowseFlag>" +
      "<Filter>*</Filter>" +
      "<StartingIndex>0</StartingIndex>" +
      "<RequestedCount>200</RequestedCount>" +
      "<SortCriteria></SortCriteria>" +
      "</u:Browse>" +
      "</s:Body></s:Envelope>";

    return fetch(server.controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
      },
      body: body
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error("浏览请求失败: " + res.status);
        }
        return res.text();
      })
      .then(function (xmlText) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(xmlText, "text/xml");
        var resultNode = doc.getElementsByTagName("Result")[0];
        if (!resultNode) {
          throw new Error("目录数据为空");
        }
        return parseDidlLite(resultNode.textContent);
      });
  }

  function renderServers() {
    serverList.innerHTML = "";
    state.servers.forEach(function (server) {
      var li = document.createElement("li");
      var button = document.createElement("button");
      button.className = "item" + (state.selectedServer && state.selectedServer.id === server.id ? " active" : "");
      button.innerHTML = "<strong>" + server.name + "</strong><small>" + server.location + "</small>";
      button.addEventListener("click", function () {
        state.selectedServer = server;
        state.objectId = "0";
        state.stack = [];
        renderServers();
        loadCurrentFolder();
      });
      li.appendChild(button);
      serverList.appendChild(li);
    });
  }

  function renderContent(entries) {
    contentList.innerHTML = "";
    entries.forEach(function (entry) {
      var li = document.createElement("li");
      var button = document.createElement("button");
      button.className = "item";
      button.textContent = (entry.type === "container" ? "📁 " : "▶ ") + entry.title;

      button.addEventListener("click", function () {
        if (entry.type === "container") {
          state.stack.push({ id: state.objectId, title: currentPath.textContent });
          state.objectId = entry.id;
          currentPath.textContent = entry.title;
          loadCurrentFolder();
          return;
        }

        if (!entry.url || !isHttpUrl(entry.url)) {
          setStatus("媒体地址不可播放", true);
          return;
        }

        player.src = entry.url;
        player
          .play()
          .then(function () {
            setStatus("正在播放: " + entry.title);
          })
          .catch(function (error) {
            setStatus("播放失败: " + error.message, true);
          });
      });

      li.appendChild(button);
      contentList.appendChild(li);
    });
  }

  function loadCurrentFolder() {
    if (!state.selectedServer) {
      setStatus("请先选择 DLNA 服务器", true);
      return;
    }

    setStatus("正在读取目录...");
    soapBrowse(state.selectedServer, state.objectId)
      .then(function (entries) {
        if (!currentPath.textContent || currentPath.textContent === "尚未选择服务器") {
          currentPath.textContent = state.selectedServer.name + " / 根目录";
        }
        renderContent(entries);
        setStatus("目录加载完成，共 " + entries.length + " 项");
      })
      .catch(function (error) {
        setStatus("目录加载失败: " + error.message, true);
      });
  }

  function webOSDiscoverLocations() {
    return new Promise(function (resolve, reject) {
      if (!window.webOS || !window.webOS.service || !window.webOS.service.request) {
        reject(new Error("当前环境未注入 webOS.service.request，无法自动扫描"));
        return;
      }

      window.webOS.service.request("luna://com.webos.service.upnp", {
        method: "discover",
        parameters: { serviceType: "urn:schemas-upnp-org:device:MediaServer:1", timeout: 6 },
        onSuccess: function (res) {
          var locations = [];
          var raw = res && (res.devices || res.deviceList || res.results || []);
          raw.forEach(function (device) {
            var location = device.location || device.url || device.descriptionUrl;
            if (location) {
              locations.push(location);
            }
          });
          resolve(locations);
        },
        onFailure: function (err) {
          reject(new Error((err && err.errorText) || "UPnP 扫描失败"));
        }
      });
    });
  }

  function discoverServers() {
    setStatus("正在扫描 DLNA 服务器...");
    serverList.innerHTML = "";
    contentList.innerHTML = "";
    currentPath.textContent = "尚未选择服务器";

    webOSDiscoverLocations()
      .then(function (locations) {
        if (!locations.length) {
          throw new Error("未发现 DLNA 服务器");
        }
        return Promise.all(
          locations.map(function (location) {
            return fetch(location)
              .then(function (res) {
                if (!res.ok) {
                  throw new Error("设备描述下载失败");
                }
                return res.text();
              })
              .then(function (xmlText) {
                return parseDeviceDescription(xmlText, location);
              })
              .catch(function () {
                return null;
              });
          })
        );
      })
      .then(function (servers) {
        state.servers = servers.filter(Boolean);
        if (!state.servers.length) {
          throw new Error("发现设备但未找到可浏览的 ContentDirectory");
        }
        renderServers();
        setStatus("发现 " + state.servers.length + " 台 DLNA 服务器");
      })
      .catch(function (error) {
        setStatus(error.message + "。可确认应用以 webOS TV 应用方式运行并开放相关权限。", true);
      });
  }

  discoverBtn.addEventListener("click", discoverServers);
  refreshBtn.addEventListener("click", loadCurrentFolder);
  backBtn.addEventListener("click", function () {
    if (!state.selectedServer) {
      return;
    }

    if (!state.stack.length) {
      state.objectId = "0";
      currentPath.textContent = state.selectedServer.name + " / 根目录";
      loadCurrentFolder();
      return;
    }

    var previous = state.stack.pop();
    state.objectId = previous.id;
    currentPath.textContent = previous.title;
    loadCurrentFolder();
  });

  applySubtitleBtn.addEventListener("click", function () {
    loadSubtitleByUrl(subtitleInput.value.trim());
  });

  clearSubtitleBtn.addEventListener("click", function () {
    subtitleInput.value = "";
    clearTracks();
    setStatus("字幕已清除");
  });
})();
