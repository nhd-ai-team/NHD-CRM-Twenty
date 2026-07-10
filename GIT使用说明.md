# Git 使用说明

本项目可以推送到 GitHub 做版本回退，但公共仓库中不能包含真实密钥和业务数据。

## 不提交的内容

- `.env`：包含数据库密码、Twenty API Key、Chatwoot Token、加密密钥
- `backup/`：包含数据库备份和附件备份
- `*.dump`、`*.tgz`：备份文件
- 构建产物和依赖目录，例如 `node_modules/`、`twenty/front-build-output/`

## 首次拉取后

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 按实际环境填写 `.env`。
3. 启动前先确认 Docker/OrbStack 可用。

## 常用命令

```bash
git status
git add .
git commit -m "描述本次修改"
git push
```

## 回退版本

先查看历史：

```bash
git log --oneline
```

如需回到某个历史版本，优先先新建分支测试，不要直接覆盖当前工作：

```bash
git switch -c restore-test <commit-id>
```

