import { _decorator, assetManager, Component, Font, Node } from "cc";
const { ccclass, property } = _decorator;

// openFullscreen();

export var gc: GameController;

@ccclass("GameController")
export class GameController extends Component {

  onLoad() {
    gc = this;
  }
  
  start() {
  }

  update(deltaTime: number) {}

 

  redirectToStore() {    
    try {
      PlayableSDK.download();
      PlayableSDK.game_end();            
    } catch (error) {
      
    }
  }
}



type GameLoad = {
  gameName: string;
  font: string;
  customScale: number;
  customHeight: number;
  customTop: number;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  callback?: Function;
};

var loaded = false;

const gameLoad: GameLoad = {
    gameName: " Pixel Bus Sort ",
    font: "Arial",
    customScale: 1.5,
    customHeight: 100,
    customTop: 30,
    fillStyle: "#ffffff",
    strokeStyle: "#000000",
    lineWidth: 3,
    textBaseline: "top",
    textAlign: "center",
    callback: async (sp: any) => {

      if(loaded) return;
      loaded = true;
      const fontName = "DVN-Fredoka-Bold"; 
      const fontUuid = "cejhIaZllGjbSR0e8PaJLH";
      assetManager.loadAny(fontUuid, async (err, asset: Font) => {
        if (err) {
          console.error(err);
          return;
        }

        gameLoad.font = fontName;

        // Build single-file (mini-game adapter) đã tự add font vào document.fonts
        // ngay trong lúc load asset (dùng data embedded, không fetch mạng). Chạy
        // trên localhost (web build thường) thì chưa có, nên phải tự add bằng
        // FontFace + asset.nativeUrl (lúc này nativeUrl là URL fetch được thật).
        // const isRegistered = document.fonts.check(`12px "${fontName}"`);
        // if (!isRegistered) 
        {
          try {
            const fontFace = new FontFace(fontName, `url(${asset.nativeUrl})`);
            await fontFace.load();
            document.fonts.add(fontFace);
          } catch (e) {
            console.warn('Add font to document failed:', e);
          }
        }

        sp.initWaterMark();
      });
    },
  };

try {
  //@ts-ignore
  window.gameLoad = gameLoad;
  //@ts-ignore ms
  window.totalTime = 1000;
} catch (error) {  
}




// full screen

function openFullscreen() {
  let fullscreenRequested = false;

  async function enterFullscreen() {
      if (fullscreenRequested) return;

      fullscreenRequested = true;

      try {
          if (!document.fullscreenElement) {
              await document.documentElement.requestFullscreen();
          }
      } catch (e) {
          console.warn('Fullscreen failed:', e);
      }
  }

  document.addEventListener('pointerdown', enterFullscreen, { once: true });
}



