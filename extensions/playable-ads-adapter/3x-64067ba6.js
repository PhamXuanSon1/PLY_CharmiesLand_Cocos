"use strict";
var e = require("electron"),
  r = require("child_process"),
  t = require("os"),
  o = require("fs"),
  a = require("path"),
  n = require("./playable-adapter-core-0ce23d83.js");
function i(e) {
  return e && "object" == typeof e && "default" in e ? e : { default: e };
}
var l = i(r),
  c = i(t);
const { exec: s, execSync: d } = l.default;
var u = {
  run: function (e, r) {
    return s(e, function (e, t, o) {
      r && r(e, t, o);
    });
  },
  runSync: function (e) {
    try {
      return { data: d(e).toString(), err: null, stderr: null };
    } catch (e) {
      return {
        data: null,
        err: e.stderr.toString(),
        stderr: e.stderr.toString(),
      };
    }
  },
};
const p = "playable-ads-adapter",
    f = () => {
    return {
      buildPlatform: "web-mobile",
      exportChannels: [
        "AppLovin",
        "Facebook",
        "Google",
        "Mintegral",
        "Tiktok",
        "IronSource",
        "Unity",
      ],
      orientation: "auto",
      injectOptions: {
        AppLovin: {
          head: "<script>function redirectStore(){mraid.open()}</script>",
          body: "",
          sdkScript: "",
        },
        Facebook: {
          head: "",
          body: "<script>function redirectStore(){FbPlayableAd.onCTAClick()}</script>",
          sdkScript: "",
        },
        Google: {
          head: "<meta name='ad.size' content=\"width=320,height=480\" >",
          sdkScript: "",
          body: "<script>var clickTag='';var android='';function setStoreUrl(iosUrl, androidUrl){clickTag=iosUrl;android=androidUrl;if(/android/i.test(navigator.userAgent)){clickTag=android}};function redirectStore(){window.open(clickTag)}</script>",
        },
        Mintegral: {
          head: "",
          body: "<script>function redirectStore(){window.install && window.install()} function onGameEnd(){window.gameEnd && window.gameEnd()} function onGameReady(){window.gameReady && window.gameReady()} function gameStart() { console.log('game has started') } function gameClose() { console.log('game closed') }</script>",
          sdkScript: "",
        },
        Tiktok: {
          head: "",
          body: "<script>function redirectStore(){window.playableSDK.openAppStore()}</script>",
          sdkScript: "",
        },
        IronSource: {
          head: "<meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'>",
          body: "<script>if(mraid.getState()==='loading'){mraid.addEventListener('ready',onSdkReady)}else{onSdkReady()}function viewableChangeHandler(viewable){if(viewable){}else{}}function onSdkReady(){console.log('ready');mraid.addEventListener('viewableChange',viewableChangeHandler);mraid.addEventListener('audioVolumeChange',audioVolumeChangeCallback);if(mraid.isViewable()){}}var volume = 100;var url='';var android='';function setStoreUrl(iosUrl, androidUrl){url=iosUrl;android=androidUrl;if(/android/i.test(navigator.userAgent)){url=android}};function redirectStore(){mraid.open(url)};function showMyAd(){};function audioVolumeChangeCallback(e){console.log(e);volume = e}</script>",
          sdkScript: '<script src="./mraid.js"></script>',
        },
        Unity: {
          head: "\n<!--https://play.google.com/store/apps/details?id=com.abi.dream.unpacking\n-->\n<!--https://apps.apple.com/us/app/dreamy-room/id6742221896?platform=iphone\n-->",
          body: "<script>if(mraid.getState()==='loading'){mraid.addEventListener('ready',onSdkReady)}else{onSdkReady()}function viewableChangeHandler(viewable){if(viewable){}else{}}function onSdkReady(){mraid.addEventListener('viewableChange',viewableChangeHandler);if(mraid.isViewable()){showMyAd()}}var url='';var android='';function setStoreUrl(iosUrl, androidUrl){url=iosUrl;android=androidUrl;if(/android/i.test(navigator.userAgent)){url=android}};function redirectStore(){mraid.open(url)};function showMyAd(){}</script>",
          sdkScript: '<script src="./mraid.js"></script>',
        },
      },
    };
  },
  h = () => {
    const e = Editor.Project.path,
      r = "/build",
      t = f();
    let o = t?.buildPlatform ?? "web-mobile";
    return {
      projectRootPath: e,
      projectBuildPath: r,
      buildPlatform: o,
      originPkgPath: a.join(e, r, o),
      adapterBuildConfig: t,
    };
  },
  g = () => {
    const e = f();
    return !!e && (e.skipBuild ?? !1);
  };
var m = require("path").join(__dirname + "/3x-23a715e3.js");
const P = (e) =>
    new Promise((r, t) => {
      let o = Editor.App.path;
      const a = (() => {
        const e = c.default.platform();
        return "win32" === e
          ? "WINDOWS"
          : "darwin" === e
            ? "MAC"
            : e.toUpperCase();
      })();
      "MAC" === a
        ? (o = o.replace("/Resources/app.asar", "/MacOS/CocosCreator"))
        : "WINDOWS" === a
          ? (o = ((e) => {
              let r = e;
              return (-1 !== r.indexOf("\\") && (r = r.replace(/\\/g, "/")), r);
            })(o).replace("/resources/app.asar", "/CocosCreator.exe"))
          : t(`不支持${a}平台构建`);
      u.run(
        `${o} --project ${Editor.Project.path} --build "platform=${e}"`,
        (e, t, o) => {
          (console.log(e, t, o), r());
        },
      ).stdout.on("data", (e) => {
        console.log(e);
      });
    }),
  j = async (e) => {
    (console.log(`${p} 进行预构建处理`), console.log(`${p} 跳过预构建处理`));
  },
  b = (e) =>
    new Promise(async (r, t) => {
      const {
          projectRootPath: o,
          projectBuildPath: i,
          adapterBuildConfig: l,
        } = h(),
        c = a.join(o, i);
      console.info(`${p} 开始适配，导出平台 ${e.platform}`);
      const s = new Date().getTime(),
        d = () => {
          const e = new Date().getTime();
          (console.log(`${p} 适配完成，共耗时${((e - s) / 1e3).toFixed(0)}秒`),
            r(!0));
        },
        u = (e) => {
          (console.error("适配失败"), t(e));
        },
        f = {
          buildFolderPath: c,
          buildName: e.name ?? "",
          adapterBuildConfig: { ...l, buildPlatform: e.platform },
        };
      try {
        ((e, r, t) => {
          const { Worker: o } = require("worker_threads");
          (console.log("支持Worker，将开启子线程适配"),
            new o(m, { workerData: e }).on(
              "message",
              ({ finished: e, msg: o, event: a }) => {
                "adapter:finished" !== a
                  ? console[a.split(":")[1]](o)
                  : e
                    ? r()
                    : t(o);
              },
            ));
        })(f, d, u);
      } catch (e) {
        (console.log("不支持Worker，将开启主线程适配"),
          await n.exec3xAdapter(f, { mode: "serial" }),
          d());
      }
    });
((exports.BUILDER_NAME = p),
  (exports.builder3x = async () => {
    try {
      const { buildPlatform: r, projectRootPath: t, projectBuildPath: o } = h();
      console.log(`开始构建项目，导出${r}包`);
      const n = g(),
        i = a.join(t, o);
      (await j(),
        n || (await P(r)),
        await b({ platform: r }),
        e.shell.openPath(i),
        console.log("构建完成"));
    } catch (e) {
      console.error(e);
    }
  }),
  (exports.initBuildFinishedEvent = b),
  (exports.initBuildStartEvent = j));
