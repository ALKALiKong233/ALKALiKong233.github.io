---
layout:     post
title:     ArchLinux安装教程-第二部分
subtitle:   archlinux-install-guide-2
date:       2019-09-22
author:     ALKALiKong，lexoily
header-img: img/post-bg-universe.jpg
catalog: true
tags:
    - ArchLinux
---
Archlinux安装教程第二部分
这里是第二部分。此部分目的为搭建一个比较完整的(开始有图形界面了哦)系统环境。目前我们大致已经把最困难的部分攻关了，想必你也是。后面的步骤比较繁琐，请不要放弃。


## 连接网络
输入```ping -c4 192.168.1.1```出现这样的提示
```
ping：192.168.1.1: Name or service not known
```
则说明你没有连接到网络，那么跟着我们输入后面的命令
输入```ip link```查看一下2.后面的```xxxx：<xxxxxx>```
然后输入```ip link set xxxx up```
以我的电脑举个例子：
输入```ip link```输出了以下结果
```
1.lo：xxxx
2.enp5s0：xxxxx
3.wlp0s29u1u5：xxxx
```
这时我们输入```ip link set enp5s0 up```并```reboot```重启
当然每个人的情况不同，所以你可以把所有输出给你的名字都set up一遍
进入系统后输入（不分顺序，但比较推荐先输入第二个再输入第一个）
```
systemctl enable dhcpcd（wifi-menu）
systemctl start dhcpcd（wifi-menu）
```
然后再ping一下检查网络是否联通


## 安装图形界面
我们这里推荐安装gnome、dde、kde(因为易用且配置简单，当然和我一样选择xfce也是可以的)
举个例子：
命令：```pacman -S gnome```(最基础的gnome环境)
```pacman -S deepin```(用这里的汉化就可以省略第三部分的汉化方法了)
```pacman -S plasma-desktop```(最基础的kde环境)
其他桌面环境的安装具体可以参考这个
https://wiki.archlinux.org/index.php/Desktop_environment#List_of_desktop_environments


## networkmanager的安装和配置
安装命令：```pacman -S networkmanager```
启用networkmanager
命令：
```
systemctl start NetworkManager
systemctl enable NetworkManager
```
(注意大小写)
为了避免有些桌面环境没有带网络图标我们可以通过下面的命令来安装
```pacman -S network-manager-applet```


## 登录界面的安装和配置
注意：sddm（如果你安装了kde的话）:```systemctl enable gdm```
gdm（如果安装了gnome的话）: ```systemctl enble sddm```
如果你都没安装的话...就安lightdm吧
不要同时启用几个dm，会报错

安装：```pacman -S lightdm```
配置：```nano /etc/lightdm/lightdm.conf```
找到#greeter-session=example-gtk-gnome这一行把#去掉如果喜欢gnome的登录界面就不用做其他修改了（前提是你安装了gnome桌面环境），如果喜欢dde的登陆界面把example-gtk-gnome改为lightdm-deepin-greeter按ctrl+o保存ctrl+x退出。
设置开机启动：```systemctl enable lightdm```
这一步有很大缺陷，建议看看第三部分的light-geerter配置，不过可以作为实例来提供参考


## 创建用户和制定机器名
下面的命令有点长请仔细输入避免不必要的麻烦
创建用户名：
```useradd -m -g users -G wheel -s /bin/bash xxx(这里填入你喜欢的用户名)```
创建密码
输入：```passwd xxx(你喜欢的用户名)```
注意这里一定输入正确的命令不然无法登录系统，如果输入错误并出现无法登录系统的错误。

输入```echo xxxx>>/etc/hostname```即可（注，xxxx为你喜欢的机器名，自己替换即可）
举个例子，例如我想要test这个机器名则输入
```echo test>>/etc/hostname```

下面是赋予用户权限的过程
安装sudo：
```pacman -S sudo```（sudo已在base-devel组中包含）
输入```nano /etc/sudoers```，进入界面后找到
```
# %wheel ALL=(ALL)ALL
```
这一行并把#去掉，找到#%sudo ALL=(ALL) ALL把%sudo替换为你的用户名，最后同样去掉#保存退出
接下来还需要编辑/etc/hosts，并填入：
```
127.0.0.1      localhost
```
然后```reboot```重启就好

## 显卡驱动的安装
```pacman -S xf86-video-intel```(集成显卡驱动)
```pacman -S nvidia```(英伟达显卡驱动)
具体的显卡驱动安装包详情通过这里来查询
https://wiki.archlinux.org/index.php/Xorg#Driver_installation

## 安装xorg
输入```pacman -S xorg```即可（注，如果是kde,gnome,dde等桌面环境请直接跳到第八步，因为依赖中有这个包）

注：此时无论是安装dde、gnome、kde桌面环境的输入```systemctl start lightdm```(或sddm/gdm)即可进入桌面环境。进入桌面环境后所有sudo的操作都会获取superuser的权限让你输入密码，输入登陆密码即可

## 字体安装
arch官方的例子是：
```
sudo pacman -S ttf-dejavu
sudo pacman -S wqy-zenhei
sudo pacman -S wqy-microhei
```
我推荐安装谷歌和adobe合作一款开源字体
```
sudo pacman -S adobe-source-han-serif-cn-fonts
```
(简体中文宋体)
```
sudo pacman -S adobe-source-han-sans-cn-
```
fonts(简体中文黑体)
```
sudo pacman -S adobe-source-han-serif-tw-fonts
```
(繁体中文宋体)
```
sudo pacman -S adobe-source-han-sans-tw-fonts
```

谷歌的nono字体(同样也是开源字体)
```
sudo pacman -S noto-sans-fonts
```
如果你想要其他字体的详情可以参考这里
https://wiki.archlinux.org/index.php/Fonts_(简体中文)#.E4.B8.AD.E6.96.87.E5.AD.97


## 扩展库的配置
输入```nano /etc/pacman.conf```进入界面后
按F6输入multilib找到#[multilib]那一行，并把那一行和它下一行的Include的#去掉，然后找到#[custom]去掉里面的custom和前面的#并把custom替换为archlinuxcn并把它下两行的#去掉找到server那一行把=后面的去掉替换为
https://mirrors.tuna.tsinghua.edu.cn/archlinuxcn/$arch
然后找到SigLevel = TrustedOnly这一行删去它，保存退出就可以了
然后输入```pacman -Syy archlinuxcn-keyring```


## aur helper的安装
```
sudo pacman -S yaourt(已停更，不太推荐)
sudo pacman -S aurman(新型，功能强大，但是有小坑)
sudo pacman -S yay(也是新型的，功能也很强大，对于中文的支持不是很好)
```
类似的工具也有很多具体参考
https://wiki.archlinux.org/index.php/AUR_helpers_(简体中文)

## 一点小尾巴：
```sudo pacman -S alsa-utils puslseaudio pulseaudio-alsa pavucontrol```然后输入
```sudo nano /etc/asound.conf```在文本中添加下面的几项
```
defaults.pcm.card 1
defaults.pcm.device 0
defaults.ctl.card 1
```
添加好后按ctrl+x然后输入y最后重启即可。
注：dde、gnome、kde桌面环境的可以省略
