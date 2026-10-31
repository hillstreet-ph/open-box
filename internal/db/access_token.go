package db

import (
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/pkg/errors"
)

func CreateAccessToken(t *model.AccessToken) error {
	return errors.WithStack(db.Create(t).Error)
}

func GetAccessTokenByHash(hash string) (*model.AccessToken, error) {
	var t model.AccessToken
	if err := db.Where("token_hash = ?", hash).First(&t).Error; err != nil {
		return nil, errors.Wrapf(err, "failed find access token by hash")
	}
	return &t, nil
}

func GetAccessTokenByIdAndUserId(id uint, userId uint) (*model.AccessToken, error) {
	var t model.AccessToken
	if err := db.Where("id = ? AND user_id = ?", id, userId).First(&t).Error; err != nil {
		return nil, errors.Wrapf(err, "failed find access token")
	}
	return &t, nil
}

func GetAccessTokensByUserId(userId uint, pageIndex, pageSize int) (tokens []model.AccessToken, count int64, err error) {
	tokenDB := db.Model(&model.AccessToken{})
	if err := tokenDB.Where("user_id = ?", userId).Count(&count).Error; err != nil {
		return nil, 0, errors.Wrapf(err, "failed get user's access tokens count")
	}
	if err := tokenDB.Where("user_id = ?", userId).
		Order(columnName("id")).
		Offset((pageIndex - 1) * pageSize).Limit(pageSize).
		Find(&tokens).Error; err != nil {
		return nil, 0, errors.Wrapf(err, "failed find user's access tokens")
	}
	return tokens, count, nil
}

func UpdateAccessToken(t *model.AccessToken) error {
	return errors.WithStack(db.Save(t).Error)
}
