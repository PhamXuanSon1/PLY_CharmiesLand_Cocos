
import { _decorator, Component, EventTouch, Input, input, misc, Node, v2, Vec2 } from 'cc';
import { ui } from './UI';
const { ccclass, property } = _decorator;

export var ipm: InputManager = null;

@ccclass('InputManager')
export class InputManager extends Component {

    static instance: InputManager = null;

    onLoad() {
        InputManager.instance = this;
        ipm = this;
    }

    startPos: Vec2 = null;

    dir: Vec2 = null;

    bindingStart(event: EventTouch) {}
    bindingMove(event: EventTouch) {}
    bindingEnd(event: EventTouch) {}
    bindingUpdate() {}

    fisrtTap() {
        if(this.isFirtMove) {
            this.isFirtMove = false;
            ui.firstMove();
        }
    }

    isFirtMove: boolean = true;
    onTouchStart(event: EventTouch) {
        this.fisrtTap();
        this.bindingStart(event);
    }

    onTouchMove(event: EventTouch) {
        this.bindingMove(event);
    }

    onTouchEnd(event: EventTouch) {
        this.bindingEnd(event);
    }

    binding() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    offBinding() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    start() {
        this.binding()
    }

    update(deltaTime: number) {
       this.bindingUpdate(); 
    }
}


