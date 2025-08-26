+++
author = "ALKALiKong"
title = "STM32 06 深入探究显示模块"
date = "2025-08-26"
description = "利用缓冲区+DMA实现高效渲染、通过串口发送图片到屏幕上显示、尝试移植LVGL v8.4"
tags = [
    "STM32",
    "CMSIS",
    "ST7789",
    "DMA",
    "LVGL",
    "C",
]
categories = [
    "STM32",
    "CMSIS",
    "DRIVER",
]

+++

## 深入探究显示

### 利用缓冲区与 DMA 加速

前面提到，我们通过挨个填充像素实现了各种图形的绘制。但是这样有一个问题：刷屏速度肉眼可见的慢。为了解决这个问题，我们就需要建立缓冲区+DMA传输。

首先，CPU运行速度是要比单个一直传输数据快的，所以CPU准备缓冲区再传输的速度是要比挨个发像素数据要快的；其次，独立的 DMA 通道可以帮助搬运数据，这可以让 CPU 从复制数据这种任务中解放出来，让 CPU 可以去做其他事情。所以借助这两个方法，我们可以实现加速。

实现：[libs: st7789: Use DMA to improve rect drawing. · ALKALiKong233/STM32-CMSIS-Learning@b3bc311](https://github.com/ALKALiKong233/STM32-CMSIS-Learning/commit/b3bc31188adf2e7884fe05806c3877216561dd2b#diff-a87fe834a3fcdcf15c6bb06a8aa895a12ceaa6a346131314c9c6a23cf339fd62)

#### 为 SPI1 开启 DMA

CMSIS SPI Driver 想要开启 DMA 运输非常简单，只需要在 `RTE_Device.h` 中配置好即可。具体来说，就是开启 RX 与 TX 的 DMA，并设置优先级即可。

``` C
//   <e> DMA Rx
//     <o1> Number <1=>1
//     <i>  Selects DMA Number (only DMA1 can be used)
//     <o2> Channel <2=>2
//     <i>  Selects DMA Channel (only Channel 2 can be used)
//     <o3> Priority <0=>Low <1=>Medium <2=>High <3=>Very High
//     <i>  Selects DMA Priority
//   </e>
#define RTE_SPI1_RX_DMA                 1
#define RTE_SPI1_RX_DMA_NUMBER          1
#define RTE_SPI1_RX_DMA_CHANNEL         2
#define RTE_SPI1_RX_DMA_PRIORITY        2

//   <e> DMA Tx
//     <o1> Number <1=>1
//     <i>  Selects DMA Number (only DMA1 can be used)
//     <o2> Channel <3=>3
//     <i>  Selects DMA Channel (only Channel 3 can be used)
//     <o3> Priority <0=>Low <1=>Medium <2=>High <3=>Very High
//     <i>  Selects DMA Priority
//   </e>
#define RTE_SPI1_TX_DMA                 1
#define RTE_SPI1_TX_DMA_NUMBER          1
#define RTE_SPI1_TX_DMA_CHANNEL         3
#define RTE_SPI1_TX_DMA_PRIORITY        2
```

之后，需要为 SPI 的 DMA 传输配置一下，由于 DMA 通道的限制，我们一次最多可以传输 65535 长度的数据，所以对于大于这个量的数据，我们需要分片传输 。

``` C
// SPI事件回调函数
static volatile uint8_t spi_transfer_complete = 0;

void SPI1_Event_Callback(uint32_t event) {
    if (event & ARM_SPI_EVENT_TRANSFER_COMPLETE) {
        // SPI传输完成
        spi_transfer_complete = 1;
    }
    if (event & ARM_SPI_EVENT_DATA_LOST) {
        // 数据丢失错误
        spi_transfer_complete = 2;  // 错误状态
    }
    if (event & ARM_SPI_EVENT_MODE_FAULT) {
        // 模式错误
        spi_transfer_complete = 2;  // 错误状态
    }
}

uint8_t st7789_interface_spi_write_cmd(uint8_t *buf, uint32_t len)
{
    int32_t status;
    GPIO_TypeDef *cs_port = GPIO_PORT(ST7789_CS_PORT);
    
    // 拉低片选
    GPIO_RESET(cs_port, ST7789_CS_PIN);
    
    uint32_t remaining = len;
    uint8_t *buf_ptr = buf;

    while (remaining > 0) {
        uint32_t to_send = ( remaining > 65535 ) ? 65535 : remaining;

        // 发送数据
        status = Driver_SPI1.Send(buf_ptr, to_send);
        if (status != ARM_DRIVER_OK) {
            GPIO_SET(cs_port, ST7789_CS_PIN); // 失败时释放片选
            return 1;
        }

        // 等待传输完成
        while (spi_transfer_complete == 0) {
            // 等待DMA传输完成或SPI忙状态结束
            if (!Driver_SPI1.GetStatus().busy && spi_transfer_complete == 0) {
                spi_transfer_complete = 1;
            }
        }
            
        // 检查是否有错误
        if (spi_transfer_complete == 2) {
            GPIO_SET(cs_port, ST7789_CS_PIN); // 错误时释放片选
            return 1;
        }

        buf_ptr += to_send;
        remaining -= to_send;

        // 重置传输完成标志
        spi_transfer_complete = 0;
    }

    // 拉高片选
    GPIO_SET(cs_port, ST7789_CS_PIN);
    
    return 0;
}
```

#### 使用缓冲区

由于我们实际上发送的是存储好的一个个 RGB565 数据，所以我们实际上可以建立一个数组，专门用来存储这些数据。DMA 也是按照 8 Bit 发送的，所以我们建立的缓冲区就是 `uint8_t` 类型的数组。但是 RGB565 是 16 位数据，因此我们需要把他拆成两个 8 位数据存储。我们是大端序传输（即从高位往低位），所以我们对于缓冲区颜色的处理就可以这样做：

``` C
for ( uint16_t i = 0; i < buffer_pixels && i < pixel_count; ++i ) {
    buf[i * 2] = (color >> 8) & 0xFF; // 高位左移8位与 0xFF 取交
    buf[i * 2 + 1] = color & 0xFF; // 低位直接与 0xFF 取交
}
```

由此，我们可以实现：

``` C
uint8_t simple_st7789_send_data_buf(uint8_t* data, uint32_t len)
{
    uint8_t res;

    // 设置DC引脚为数据模式 (高电平)
    st7789_interface_cmd_data_gpio_write(1);
    
    // 发送数据
    res = st7789_interface_spi_write_cmd(data, len);
    return res;
}

uint8_t simple_st7789_fill_rect(uint16_t x, uint16_t y, uint16_t width, uint16_t height, uint16_t color)
{
    uint8_t res;
    uint32_t pixel_count = width * height;
    
    // 边界检查
    if (x >= ST7789_WIDTH || y >= ST7789_HEIGHT) return 1;
    if (x + width > ST7789_WIDTH) width = ST7789_WIDTH - x;
    if (y + height > ST7789_HEIGHT) height = ST7789_HEIGHT - y;
    
    // 设置绘制窗口
    res = simple_st7789_set_window(x, y, x + width - 1, y + height - 1);
    if (res != 0) return res;
    
    // 开始写入像素数据
    res = simple_st7789_send_command(ST7789_RAMWR);
    if (res != 0) return res;
    
    // 发送颜色数据
    uint8_t buf[4096];
    uint32_t buffer_pixels = sizeof(buf) / 2;
    for ( uint16_t i = 0; i < buffer_pixels && i < pixel_count; ++i ) {
        buf[i * 2] = (color >> 8) & 0xFF;
        buf[i * 2 + 1] = color & 0xFF;
    }
    uint32_t remaining = pixel_count;
    while (remaining > 0) {
        uint32_t to_send = ( remaining >= buffer_pixels ) ? buffer_pixels : remaining;
        res = simple_st7789_send_data_buf(buf, to_send * 2);
        if ( res != 0 ) return res;
        remaining -= to_send;
    }
    
    return 0;
}
```

通过 `simple_st7789_send_data_buf()` 即可发送缓冲区。这样，矩形的绘制就实现了加速绘制。

### 通过串口传输图片显示到显示屏上

既然图形绘制的本质就是绘制像素点，并且我们已经了解到缓冲区的做法，那么如果我们把一个图片也转换成一个个缓冲区，并想办法写入到显示器内，不就可以显示图片了嘛？那么 STM32 与外界交互，最简单的方式就是通过串口传输了。由此，[samples: Implement utils to send an image via serial. · ALKALiKong233/STM32-CMSIS-Learning@511a7ce](https://github.com/ALKALiKong233/STM32-CMSIS-Learning/commit/511a7cea85777364fcdf9abe294ef1c283dd151e) 便产生了。

#### 实现原理

由于 STM32F103 那孱弱的性能与配置，在单片机内实现编解码图片肯定是不太现实了。所以，我们可以借助电脑来转换生成编码好的数据，并传输给单片机。因此，我们就需要定义一种“协议”来实现单片机与电脑的交流。

我定义的通信方式如下：

1. 当 Key1 按下时，单片机通过串口输出 `IMAGE_RECEIVER_READY`，指示主机单片机已就绪。
2. 开始循环读入数据，依据 `ROWS_IN_A_CHUNK` 定义的单区块中包含的函数，来确定需要多少次循环。
3. 每次循环读取开始时，单片机通过串口输出 `READY_CHUNK_%d\n`，指示主机可以发送第 `%d` 区块的数据了。之后单片机会一直等待主机数据传输完成。
4. 接收完成后，单片机会向显示器写入数据，完成后通过串口输出 `CHUNK_%d_OK, len: %d` ，告知主机区块完成，读取到了多长的数据。
5. 重复 3~4, 直到图片完整接收。

具体实现直接看上面的 commit 吧，Python 脚本是直接用 AI 生成的。（不过其他地方也没少用AI就是了）

### 移植 LVGL

这个算是最难入手的部分之一了（

#### 添加基本骨架

我们先来看 LVGL 的项目结构（以 v8.4.0 为例）

``` 
lvgl/
├── docs/                # 文档，使用说明及开发者参考
├── examples/            # LVGL 的各类示例代码
│   ├── porting/  		 # 有关移植的例子
│   └── ...              # 其他例子
├── include/             # LVGL 的头文件（API接口定义）
├── src/                 # LVGL 的源码
│   ├── core/            # 核心模块
│   ├── draw/            # 绘图相关
│   ├── font/            # 字体相关
│   ├── hal/             # 硬件抽象层
│   ├── misc/            # 杂项工具
│   ├── widgets/         # 各种控件
│   └── ...              # 其他模块
├── tests/               # 单元测试代码
├── LICENSE              # 版权和许可协议
├── README.md            # 项目介绍和快速入门
├── lvgl.h               # LVGL 主头文件
├── CMakeLists.txt       # CMake 构建脚本
├── Kconfig              # 配置选项（用于 Kconfig 工具）
├── lv_conf_template.h   # 配置模板头文件
└── ...                  # 其他文件
```

因为 csolution 没有使用 Make/CMake 作为构建系统，所以我们无法使用它自带的 Makefiles。

因此，对于我们而言，关键的就是 `examples/porting`、`src`、`lvgl.h`、`lv_conf_template.h`。将这些文件复制到 libs 内，然后在 cproject 里包含所有源代码文件。

**注意，不要自己删除 src 里的任何内容，并且要确保 src 内所有源代码文件都被编译（虽然其实并非如此）。**src 内包含的是 LVGL 的源码，我们在事实上不应该修改他（这是由 LVGL 维护的）。至于哪些文件应该被编译，其实这应该是由 Make/CMake 决定的，但是我们使用的 csolution 并不支持这些，所以直接毁灭吧，全都编译算了。你可能会觉得编译这么多文件不会把 STM32 那点 ROM 撑爆嘛，答案是**最后被放进ROM里的东西是由 linker 决定的**，linker 只会把使用到的内容连接进程序内。所以我们一会要对 `lv_conf` 进行修改，关闭部分我们用不到的内容，以缩小 ROM 占用。**切忌直接修改 src 的内容，那不是我们该碰的地方！！！（因为我一开始就这么做了qwq）。**

具体添加的内容可以参考 [libs: lvgl: Import LVGL v8.4.0 skeleton. · ALKALiKong233/STM32-CMSIS-Learning@7bbefc1](https://github.com/ALKALiKong233/STM32-CMSIS-Learning/commit/7bbefc1952d5213d88e6042068581750ead8ed73#diff-7b72510f9c802907c7ac0516b7249dc68678684d666f393278fc16a102231b29) ，注意 `add-path:` 那里我写的并不正确，`- ./libs/*` 和 `- ./interface/*` 实际上应该是 `- ./libs/` 和 `- ./interface/`，我在后面的 commit 里修正了，而且其实按理来说我应该每个模块的都添加 include path 的。

#### 适配

[libs: lvgl: Adapt LVGL for STM32F103 with ST7789 support. · ALKALiKong233/STM32-CMSIS-Learning@5fd8359](https://github.com/ALKALiKong233/STM32-CMSIS-Learning/commit/5fd8359dba5b2f3e49df12988abb839633c4aa68) 阅读时请酌情对照 commit 内容查看（）

具体应该做的事情，其实在 [LVGL 官方文档](https://docs.lvgl.io/master/details/integration/adding-lvgl-to-your-project/connecting_lvgl.html) 里有提到。

##### 适配 LVGL 时钟

官方文档中提到的第一件事就是 Tick Interface，即 LVGL 需要感知到时间。文档中提到了两种方式，可以在循环中调用 `lv_tick_set_cb(my_get_milliseconds)` 来获取时间，也可以调用 `lv_tick_inc(x)` 更新时间。正好我们的 SysTick 是利用中断进行毫秒计数，可以直接在中断的回调函数中添加 `lv_tick_inc(1)` 实现。

##### 适配显示接口

在这里，我们就可以参照 `examples/porting` 里的 `lv_port_disp` 来实现了。

首先，在 DEFINES 里定义好屏幕分辨率，我们使用的是竖屏，所以这样定义：

``` C
#ifndef MY_DISP_HOR_RES
    #define MY_DISP_HOR_RES    240
#endif
#ifndef MY_DISP_VER_RES
    #define MY_DISP_VER_RES    320
#endif
```

在 GLOBAL FUNCTIONS 里，有缓冲区的几种定义方法，我们只需要选择其中一种就可以了，这里我选了第一种。其实选第二种也不会有太大的性能提升，毕竟瓶颈大部分都在 CPU 上（应该是吧），只需要把另外两种删掉即可。

接下来是 STATIC FUNCTIONS ，里面需要我们自己实现的是 `disp_init` 与 `disp_flush` 。

初始化屏幕还是很简单的，只需要调用我们自己的 `simple_st7789_init();` 即可。

而屏幕刷新函数，我们来关注一下他的函数原型：

``` C
static void disp_flush(lv_disp_drv_t * disp_drv, const lv_area_t * area, lv_color_t * color_p)
```

其中， area 包含了窗口的位置 ( x1, x2, y1, y2 )，color_p 是一个颜色数据的指针。在 RGB565 中，这个指针可以直接被看作色彩数据的缓冲区。所以，我们可以直接调用 send_buf 发送数据。

``` C
static void disp_flush(lv_disp_drv_t * disp_drv, const lv_area_t * area, lv_color_t * color_p)
{
    if(disp_flush_enabled) {
        simple_st7789_set_window(area->x1, area->y1, area->x2, area->y2);
        simple_st7789_send_command(ST7789_RAMWR);
        
        uint32_t pixel_count = (area->x2 - area->x1 + 1) * (area->y2 - area->y1 + 1);
        uint32_t data_size = pixel_count * 2;
        
        uint8_t* pixel_data = (uint8_t*)color_p;
        
        simple_st7789_send_data_buf(pixel_data, data_size);
    }

    /*IMPORTANT!!!
     *Inform the graphics library that you are ready with the flushing*/
    lv_disp_flush_ready(disp_drv);
}
```

这里一开始我也采用了向 send_data_buf 传输缓冲区时使用分片发送的方案，但是后来想了想发现没有必要：我们底层已经实现了 DMA 的分片传送，缓冲区也是现成的，我们只需要把缓冲区直接传过去就行了，怎么传输是 interface 层处理的事情。

##### 修改 lv_conf

这里可以直接去看 commit 里都修改了什么，我把几个值得关注的拿出来：

`LV_COLOR_16_SWAP` 这个宏决定了颜色数据储存的方式，如果是 0 那么 `lv_color_t` 将是 bgr 储存

`LV_MEM_SIZE` 定义了 LVGL 内部可用的最大内存大小，这个可以适当调小一点，因为我们的内存比较受限。

`LV_USE_PERF_MONITOR`、`LV_USE_MEM_MONITOR` 这两个是 LVGL 内置的监视器，会显示在屏幕底部，这个看个人意愿想不想开了。

`LV_FONT_SIMSUN_16_CJK` 这里包含了 1000 个常用的 CJK 字符，但是加进去之后ROM又会爆掉了，非常遗憾，就没加了（

下面没有用到的 EXTRA COMPONENTS 都可以关掉，关掉一大部分就可以节省出很多 ROM 来了。

##### 创建一个 LVGL Demo

[samples: Add a demo to show datas read from sensors using LVGL. · ALKALiKong233/STM32-CMSIS-Learning@f9ac804](https://github.com/ALKALiKong233/STM32-CMSIS-Learning/commit/f9ac804ec976f8f8f24f4b88a37deb593291b7ff)

这是一个通过读取那些传感器读数并创建进度条/滑动条的界面，创建 UI 界面这种事还是去看 LVGL 官方文档罢（

这里提一下在主程序中需要做的事：

1. 在合适的位置初始化 LVGL

``` C
    // Initialize LVGL
    lv_init();
    lv_port_disp_init();
```

2. 在循环中需要定期调用 `lv_timer_handler()`

官方是这么说的：Drive LVGL time-related tasks by calling [`lv_timer_handler()`](https://docs.lvgl.io/master/API/misc/lv_timer_h.html#_CPPv416lv_timer_handlerv) every few milliseconds to manage LVGL timers. See [Timer Handler](https://docs.lvgl.io/master/details/integration/adding-lvgl-to-your-project/timer_handler.html#timer-handler) for different ways to do this.

```
static uint32_t last_lv_timer = 0;
uint32_t current_tick = delay_get_tick();
if ( timer_expired(&last_lv_timer, 5, current_tick))
    lv_timer_handler();
```



### 最后

这篇文章大概有很多错误，所以还是批判性地看为好 OxO

这板子的性能跑 LVGL 还是略显捉急的，CPU 占用居高不下（至少LVGL的性能监视器是这么写的，我也不知道对不对 OxO）

关于 CJK 字符的问题，我觉得或许有什么别的方案把，但是我暂时想不出来力，片上ROM卡的太死了。