// Learn TypeScript:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/typescript.html
// Learn Attribute:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/reference/attributes.html
// Learn life-cycle callbacks:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/life-cycle-callbacks.html

import { AudioSource, Component, Game, _decorator, game} from 'cc';
const {ccclass, property} = _decorator;

export enum SoundType{
    BGM,
    Pick,
    Done,
    Fail,
    Win,
    Alert,
    LandRight,
    LandFail,
    Hen,
    Hen2
}

export var sm: SoundManager = null;

@ccclass
export default class SoundManager extends Component {

    onLoad() {
        sm = this;
    }

    // @property(AudioSource)
    audiosource: AudioSource[] = [];
    volumes: number[] = [];
    
    // @property(AudioClip)
    // audios: AudioClip[] = [];
    
    mute: boolean = false;
    fail: boolean = false;
    playBG: boolean = false;

    playSound(type: SoundType, loop: boolean = false, call = () => {}): AudioSource{
        if(this.fail) return;
        if(this.audiosource[type]){
            if(this.audiosource[type].playing) {
            }
            this.audiosource[type].play();
            this.audiosource[type].loop = loop;
            setTimeout(() => {
                call();
            }, this.audiosource[type].duration*1000);

        }
        return this.audiosource[type];
    }

    pauseSound(type: SoundType){
        if(this.audiosource[type]){
            this.audiosource[type].pause();
        }
    }

    isPlaying(type: SoundType): boolean {
        return this.audiosource[type].playing;
    }
    

    playSounds(types: SoundType[], loop: boolean = false, step: number = 0, call = () => {}){        
        this.playNext(types, 0, loop, step, call);
    }

    playNext(types: SoundType[], index: number, loop: boolean = false, step: number = 0, call = () => {}){
        if(index >= types.length) return;
        let beLoop = false;
        if(index == types.length-1) {
            beLoop = loop;
            call();
        }
        let audio = this.playSound(types[index], beLoop);
        if(!audio) return;
        setTimeout(() => {
            this.playNext(types, index+1, loop, step, call);
        }, (audio.duration + step)*1000*0.5);
    }

    stopAll(){
        this.fail = true;
        for(let i = 0; i < this.audiosource.length; i++){
            this.audiosource[i].stop();
        }
    }

    stopSound(type: SoundType){
        this.audiosource[type].stop();
    }


    checkAudio() {
        if(window.volume !== undefined) {
            if(window.volume >= 10) {
                this.unMuteAll();
            } else {
                this.muteAll();
            }
        }
    }

    playBgMusic() {
        if(this.playBG) return;
        this.playBG = true;
        setTimeout(() => {
            this.playSound(SoundType.BGM, false, () => {
                this.playSound(SoundType.BGM, true);
            });            
        }, 100);
    }
    start () {
        // this.playBgMusic();
        this.audiosource = this.node.getComponentsInChildren(AudioSource);
        this.volumes = this.audiosource.map(a => a.volume);
        this.eventSound();        
        this.schedule(this.checkAudio, 1);
        this.checkAudio();
        
        
    }
    eventSound() {
        
        game.on(Game.EVENT_HIDE, () => {
           this.muteAll(); 
        });

        game.on(Game.EVENT_SHOW, () => {
           this.unMuteAll(); 
        });

        window.addEventListener("audioChanged", (e: CustomEvent) => {
            if (e.detail.mute) {
                this.muteAll();
            } else {
                this.unMuteAll();

            }
        });

        document.addEventListener("visibilitychange", () => {
            if(document.hidden) {
                this.muteAll();
            } else {
                this.unMuteAll();
            }
          });
          
          document.addEventListener("pause", () => {
            // Thiết bị bị khóa màn hình
            console.log("Màn hình đã bị khóa");
            this.muteAll();
          });
          
          document.addEventListener("play", () => {
            // Thiết bị mở màn hình trở lại
            console.log("Màn hình đã được mở lại");
            this.unMuteAll();
          });
          
    }

    public muteAll(): void {
        console.log("muteAll");
        
        try {
        for(let i = 0; i < this.audiosource.length; i++){
            this.audiosource[i].volume = 0;
        }
            
        } catch (error) {
            
        }
    }

   public unMuteAll(): void {
        console.log("unMuteAll");
        
        try {
        for(let i = 0; i < this.audiosource.length; i++){
            this.audiosource[i].volume = this.volumes[i];
        }
            
        } catch (error) {
            
        }
    }

    update (dt) {
    }
}
